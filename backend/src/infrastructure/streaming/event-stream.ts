import type { ServerResponse } from 'node:http';
import type { SimulationRepository } from '../../application/simulation/contracts.js';
import { isTerminalStatus } from '../../domain/simulation/lifecycle.js';
import { ApplicationError } from '../../application/simulation/contracts.js';

export class EventStream {
  private readonly clients = new Map<ServerResponse, string>();

  reserve(response: ServerResponse, runId: string): void {
    if (this.clients.size >= 16 || [...this.clients.values()].filter((id) => id === runId).length >= 4) {
      throw new ApplicationError('SSE_CONNECTION_LIMIT', 429);
    }
    this.clients.set(response, runId);
    response.once('close', () => this.clients.delete(response));
  }

  async stream(repository: SimulationRepository, runId: string, cursor: number, response: ServerResponse): Promise<void> {
    let lastHeartbeat = Date.now();
    try {
      while (!response.destroyed && !response.writableEnded) {
        const events = await repository.events(runId, cursor);
        for (const event of events) {
          if (response.destroyed || response.writableEnded) return;
          const frame = `id: ${runId}:${event.sequence}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`;
          if (!response.write(frame)) { response.end(); return; }
          cursor = event.sequence;
        }
        const run = await repository.read(runId);
        if (isTerminalStatus(run.status) && cursor >= run.eventSequence) { response.end(); return; }
        if (Date.now() - lastHeartbeat >= 10_000) {
          if (!response.write(': heartbeat\n\n')) { response.end(); return; }
          lastHeartbeat = Date.now();
        }
        await new Promise<void>((resolve) => {
          const done = (): void => { clearTimeout(timer); response.removeListener('close', done); resolve(); };
          const timer = setTimeout(done, 200);
          response.once('close', done);
        });
      }
    } catch {
      response.end();
    } finally {
      this.clients.delete(response);
    }
  }

  close(): void {
    for (const client of this.clients.keys()) client.end();
    this.clients.clear();
  }
}
