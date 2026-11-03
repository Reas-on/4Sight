// @vitest-environment node
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";

describe("configured Vite same-origin REST and SSE proxy", () => {
  const seen: { url?: string; host?: string; origin?: string; cookie?: string; cursor?: string }[] = [];
  const id = "11111111-1111-4111-8111-111111111111";
  const pair = `fourSightRun_${id}=${"a".repeat(64)}`;
  const cookie = `${pair}; HttpOnly; SameSite=Strict; Path=/api/v1/runs/${id}; Max-Age=604800`;
  const backend = createHttpServer((request, response) => {
    seen.push({ url: request.url, host: request.headers.host, origin: request.headers.origin,
      cookie: request.headers.cookie, cursor: request.headers["last-event-id"] as string | undefined });
    request.resume();
    if (request.url?.includes("/events")) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`id: ${id}:2\nevent: run.finished\ndata: {}\n\n`);
    } else {
      response.writeHead(202, { "content-type": "application/json", "set-cookie": cookie });
      response.end(JSON.stringify({ run: { id } }));
    }
  });
  let vite: ViteDevServer;
  let base: string;
  let previousTarget: string | undefined;
  beforeAll(async () => {
    await new Promise<void>(resolve => backend.listen(0, "127.0.0.1", resolve));
    previousTarget = process.env.BACKEND_API_TARGET;
    process.env.BACKEND_API_TARGET = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
    const reservation = createHttpServer();
    await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
    const port = (reservation.address() as AddressInfo).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    // Load the actual project config, including its existing proxy rule.
    vite = await createServer({ server: { port, strictPort: true }, logLevel: "silent" });
    await vite.listen();
    base = `http://localhost:${(vite.httpServer!.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await vite?.close();
    await new Promise<void>(resolve => backend.close(() => resolve()));
    if (previousTarget === undefined) delete process.env.BACKEND_API_TARGET;
    else process.env.BACKEND_API_TARGET = previousTarget;
  });

  it("preserves the browser Host/Origin and capability-cookie attributes", async () => {
    const response = await fetch(`${base}/api/v1/runs`, { method: "POST",
      headers: { origin: base, "content-type": "application/json" }, body: "{}" });
    expect(response.status).toBe(202);
    expect(response.headers.get("set-cookie")).toBe(cookie);
    expect(seen.at(-1)).toMatchObject({ url: "/api/v1/runs", host: new URL(base).host, origin: base });
  });

  it("forwards SSE cookies and reconnect cursors without rewriting unauthorized origins", async () => {
    for (const origin of [base, "https://untrusted.invalid"]) {
      const response = await fetch(`${base}/api/v1/runs/${id}/events?after=1`, {
        headers: { origin, cookie: pair, "Last-Event-ID": `${id}:1` },
      });
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(await response.text()).toContain(`id: ${id}:2\n`);
      expect(seen.at(-1)).toMatchObject({ origin, cookie: pair, cursor: `${id}:1` });
    }
  });
});
