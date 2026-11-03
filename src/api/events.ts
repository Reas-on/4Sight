import { ApiError, checkResponse, validate } from "./client";
import type { AuditEvent } from "./types";

export async function consumeRunEvents(id: string, after: number, signal: AbortSignal,
  onEvent: (event: AuditEvent) => Promise<void>): Promise<number> {
  const timeout = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => timeout.abort(), 25_000); };
  const combined = AbortSignal.any([signal, timeout.signal]);
  arm();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(`/api/v1/runs/${id}/events?after=${after}`, {
      credentials: "same-origin", signal: combined, headers: after ? { "Last-Event-ID": `${id}:${after}` } : {},
    });
    await checkResponse(response);
    if (!response.headers.get("content-type")?.startsWith("text/event-stream") || !response.body) throw new ApiError("INVALID_EVENT_STREAM");
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      arm();
      buffer = (buffer + decoder.decode(next.value, { stream: true })).replaceAll("\r\n", "\n");
      if (buffer.length > 128_000) throw new ApiError("INVALID_EVENT_STREAM");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const lines = frame.split("\n");
        const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        let payload: unknown;
        try { payload = JSON.parse(data); } catch { throw new ApiError("INVALID_EVENT_STREAM"); }
        const event = validate<AuditEvent>("event", payload);
        const eventId = lines.find((line) => line.startsWith("id:"))?.slice(3).trim();
        if (event.runId !== id || eventId !== `${id}:${event.sequence}`) throw new ApiError("INVALID_EVENT_STREAM");
        if (event.sequence <= after) continue;
        if (event.sequence !== after + 1) throw new ApiError("EVENT_SEQUENCE_GAP");
        await onEvent(event);
        after = event.sequence;
      }
    }
    return after;
  } finally {
    clearTimeout(timer!);
    await reader?.cancel().catch(() => undefined);
  }
}

export type EventConsumer = typeof consumeRunEvents;
