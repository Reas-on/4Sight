import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeRunEvents } from "./events";
import { eventFixture, idOne, idTwo } from "./testFixtures";

afterEach(() => vi.unstubAllGlobals());
const frame = (sequence: number, runId = idOne) => `id: ${runId}:${sequence}\nevent: step.started\ndata: ${JSON.stringify(eventFixture(sequence, runId))}\n\n`;
function mockStream(text: string) {
  const bytes = new TextEncoder().encode(text);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, 27)); controller.enqueue(bytes.slice(27)); controller.close();
  } }), { headers: { "content-type": "text/event-stream" } })));
}
describe("ordered SSE transport", () => {
  it("handles split frames and duplicate replay with a stable reconnect cursor", async () => {
    mockStream(frame(1) + frame(2) + frame(2) + frame(3));
    const seen: number[] = [];
    expect(await consumeRunEvents(idOne, 1, new AbortController().signal, async (event) => { seen.push(event.sequence); })).toBe(3);
    expect(seen).toEqual([2, 3]);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("after=1"), expect.objectContaining({ credentials: "same-origin", headers: { "Last-Event-ID": `${idOne}:1` } }));
  });
  it("rejects a different run or skipped sequence", async () => {
    mockStream(frame(1, idTwo));
    await expect(consumeRunEvents(idOne, 0, new AbortController().signal, async () => undefined)).rejects.toThrow("INVALID EVENT STREAM");
    mockStream(frame(3));
    await expect(consumeRunEvents(idOne, 0, new AbortController().signal, async () => undefined)).rejects.toThrow("EVENT SEQUENCE GAP");
  });
});
