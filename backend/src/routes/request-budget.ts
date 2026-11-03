import { ApplicationError } from '../application/simulation/contracts.js';

export class RequestBudget {
  private readonly clients = new Map<string, { expires: number; requests: number; creates: number }>();

  accept(ip: string, create: boolean): void {
    const now = Date.now();
    for (const [key, bucket] of this.clients) if (bucket.expires <= now) this.clients.delete(key);
    let bucket = this.clients.get(ip);
    if (!bucket) {
      if (this.clients.size >= 256) throw new ApplicationError('REQUEST_RATE_LIMITED', 429);
      bucket = { expires: now + 60_000, requests: 0, creates: 0 };
      this.clients.set(ip, bucket);
    }
    bucket.requests++;
    if (create) bucket.creates++;
    if (bucket.requests > 600 || bucket.creates > 20) throw new ApplicationError('REQUEST_RATE_LIMITED', 429);
  }
}
