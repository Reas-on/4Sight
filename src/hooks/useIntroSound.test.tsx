import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SOUND_ENABLED, useIntroSound } from "./useIntroSound";
import { GraphAudioEngine } from "../audio/GraphAudioEngine";

// Model Web Audio graph ownership/lifecycle; actual signal is measured in Chromium.
function mockAudio() {
  const sources: any[] = [];
  const contexts: any[] = [];
  const params: any[] = [];
  const param = () => {
    const p = {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    };
    params.push(p);
    return p;
  };
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  class MockAudioContext {
    state = "running";
    currentTime = 0;
    sampleRate = 8000;
    destination = node();
    onstatechange: (() => void) | null = null;
    resume = vi.fn(async () => {
      this.state = "running";
      this.onstatechange?.();
    });
    suspend = vi.fn(async () => {
      this.state = "suspended";
    });
    close = vi.fn(async () => {
      this.state = "closed";
    });
    constructor() {
      contexts.push(this);
    }
    createGain() {
      return { ...node(), gain: param() };
    }
    createStereoPanner() {
      return { ...node(), pan: param() };
    }
    createBiquadFilter() {
      return { ...node(), type: "lowpass", frequency: param(), Q: param() };
    }
    createDynamicsCompressor() {
      return {
        ...node(),
        threshold: param(),
        knee: param(),
        ratio: param(),
        attack: param(),
        release: param(),
      };
    }
    createBuffer(_channels: number, length: number) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    }
    createOscillator() {
      const source = {
        ...node(),
        frequency: param(),
        type: "sine",
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      sources.push(source);
      return source;
    }
    createBufferSource() {
      const source = {
        ...node(),
        buffer: null,
        loop: false,
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      sources.push(source);
      return source;
    }
  }
  vi.stubGlobal("AudioContext", MockAudioContext);
  return { sources, contexts, params };
}
describe("shared audio lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("defaults ON, preserves saved mute and shares one context across stages/modes", () => {
    const { contexts, sources } = mockAudio();
    const { result, rerender, unmount } = renderHook(
      ({ stage }: { stage: "background" | "complete" }) =>
        useIntroSound(stage, 0, false),
      { initialProps: { stage: "background" } },
    );
    expect(DEFAULT_SOUND_ENABLED).toBe(true);
    expect(result.current.soundEnabled).toBe(true);
    expect(contexts).toHaveLength(1);
    expect(sources.some((s) => s.loop)).toBe(true);
    rerender({ stage: "complete" });
    expect(contexts).toHaveLength(1);
    const ambient = sources.filter((s) => !s.stop.mock.calls.length);
    expect(ambient.length).toBeGreaterThan(0);
    act(() => result.current.toggleSound());
    expect(localStorage.getItem("4sight-intro-sound")).toBe("off");
    act(() => vi.advanceTimersByTime(500));
    expect(contexts[0].suspend).toHaveBeenCalledOnce();
    act(() => result.current.toggleSound());
    expect(contexts).toHaveLength(1);
    expect(localStorage.getItem("4sight-intro-sound")).toBe("on");
    unmount();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(sources.every((s) => s.disconnect.mock.calls.length)).toBe(true);
  });
  it("explicit mute and reduced motion create no audio resources", () => {
    const { contexts } = mockAudio();
    localStorage.setItem("4sight-intro-sound", "off");
    const muted = renderHook(() => useIntroSound("background", 0, false));
    expect(muted.result.current.soundEnabled).toBe(false);
    expect(contexts).toHaveLength(0);
    muted.unmount();
    localStorage.removeItem("4sight-intro-sound");
    renderHook(() => useIntroSound("complete", 0, true));
    expect(contexts).toHaveLength(0);
  });
  it("events have distinct success/failure/interception pitches and replace rapid navigation voices", () => {
    const { sources } = mockAudio();
    const engine = new GraphAudioEngine(() => {});
    engine.configure(true, false, 0, true);
    const start = sources.length;
    engine.emit("NODE_COMPLETED");
    const success = sources
      .slice(start)
      .map((s) => s.frequency.setValueAtTime.mock.calls[0][0]);
    const next = sources.length;
    engine.emit("NODE_FAILED");
    const failure = sources
      .slice(next)
      .map((s) => s.frequency.setValueAtTime.mock.calls[0][0]);
    expect(success).toEqual([261.63, 329.63]);
    expect(failure).toEqual([220, 164.81]);
    engine.emit("NODE_INTERCEPTED");
    expect(sources.at(-1).frequency.setValueAtTime.mock.calls[0][0]).toBe(196);
    engine.emit("NODE_NAVIGATED");
    const navigation = sources.at(-1);
    act(() => vi.advanceTimersByTime(60));
    engine.emit("NODE_NAVIGATED");
    expect(navigation.stop).toHaveBeenCalledTimes(2);
    engine.dispose();
  });
  it("hides/suspends and resumes ambience without rebuilding sources or replaying intro", async () => {
    const { contexts, sources } = mockAudio();
    const engine = new GraphAudioEngine(() => {});
    engine.configure(true, false, 0, true);
    const count = sources.length;
    engine.setHidden(true);
    await act(async () => vi.advanceTimersByTime(500));
    expect(contexts[0].suspend).toHaveBeenCalledOnce();
    await act(async () => engine.setHidden(false));
    expect(sources).toHaveLength(count);
    engine.dispose();
  });
  it("keeps enabled preference and safely handles blocked resume", async () => {
    const { contexts } = mockAudio();
    const engine = new GraphAudioEngine(() => {});
    engine.configure(true, false, 0, true);
    contexts[0].state = "suspended";
    contexts[0].resume.mockRejectedValue(
      new DOMException("blocked", "NotAllowedError"),
    );
    await act(async () => engine.ensure(true));
    expect(console.warn).toHaveBeenCalled();
    engine.dispose();
  });
  it("stopping simulation cancels only simulation voices and leaves ambience/interaction connected", () => {
    const { sources } = mockAudio();
    const engine = new GraphAudioEngine(() => {});
    engine.configure(true, false, 0, true);
    const ambient = sources.slice();
    engine.emit("NODE_SELECTED");
    const interaction = sources.at(-1);
    engine.emit("NODE_COMPLETED");
    const simulation = sources.slice(ambient.length + 1);
    engine.stopSimulation();
    expect(
      simulation.every((source) => source.stop.mock.calls.length === 2),
    ).toBe(true);
    expect(ambient.every((source) => source.stop.mock.calls.length === 0)).toBe(
      true,
    );
    expect(interaction.stop).toHaveBeenCalledTimes(1);
    engine.dispose();
  });
});
