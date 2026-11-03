import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMotion } from "./useMotion";

describe("coordinated view motion", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it("finishes the intro once and preserves completion across rerenders", () => {
    const { result, rerender } = renderHook(() => useMotion(false));
    expect(result.current.phase).toBe("intro");
    advance(2100);
    expect(result.current.introComplete).toBe(true);
    expect(result.current.phase).toBe("normal");
    rerender();
    expect(result.current.phase).toBe("normal");
  });

  it("allows interaction to immediately interrupt decoration", () => {
    const { result } = renderHook(() => useMotion(false));
    act(() => result.current.setImmersive(true));
    expect(result.current.introComplete).toBe(true);
    expect(result.current.phase).toBe("entering");
    advance(560);
    expect(result.current.phase).toBe("immersive");
  });

  it("safely reverses interrupted transitions and settles to the latest intent", () => {
    const { result } = renderHook(() => useMotion(false));
    act(() => result.current.setImmersive(true));
    advance(150);
    act(() => result.current.setImmersive(false));
    expect(result.current.phase).toBe("exiting");
    advance(150);
    act(() => result.current.setImmersive(true));
    advance(560);
    expect(result.current.isImmersive).toBe(true);
    expect(result.current.phase).toBe("immersive");
    act(() => result.current.setImmersive(false));
    advance(560);
    expect(result.current.phase).toBe("normal");
  });

  it("skips decorative initialization for reduced motion", () => {
    const { result } = renderHook(() => useMotion(true));
    expect(result.current.introComplete).toBe(true);
    expect(result.current.phase).toBe("normal");
    act(() => result.current.setImmersive(true));
    advance(0);
    expect(result.current.phase).toBe("immersive");
  });
});
