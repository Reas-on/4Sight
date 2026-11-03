import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOUBLE_PRESS_WINDOW,
  HOLD_DURATION,
  useHoldShortcut,
} from "./useHoldShortcut";

describe("immersive hold shortcut", () => {
  beforeEach(() =>
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }),
  );
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.replaceChildren();
  });
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  it("Results owns Escape before immersive exit and Ctrl+Space toggles it from inside the panel", () => {
    const simulation = vi.fn(),
      exit = vi.fn(),
      closeResults = vi.fn();
    renderHook(() =>
      useHoldShortcut(vi.fn(), exit, true, {
        simulation,
        resultsOpen: true,
        closeResults,
      }),
    );
    const panel = document.createElement("section");
    panel.dataset.resultsPanel = "true";
    panel.setAttribute("role", "dialog");
    panel.tabIndex = -1;
    document.body.append(panel);
    fireEvent.keyDown(panel, { code: "Escape" });
    expect(closeResults).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    fireEvent.keyDown(panel, { code: "Space", ctrlKey: true });
    expect(simulation).toHaveBeenCalledOnce();
  });
  function setup(immersive = false) {
    const toggle = vi.fn();
    const exit = vi.fn();
    const toggleCursor = vi.fn();
    const orbit = vi.fn();
    const graphActive = vi.fn(() => true);
    const simulation = vi.fn();
    const hook = renderHook(() =>
      useHoldShortcut(toggle, exit, immersive, {
        toggleCursor,
        orbit,
        graphActive,
        simulation,
      }),
    );
    return {
      ...hook,
      toggle,
      exit,
      toggleCursor,
      orbit,
      graphActive,
      simulation,
    };
  }
  const down = (target: Element = document.body, repeat = false) => {
    const event = new KeyboardEvent("keydown", {
      code: "Space",
      key: " ",
      repeat,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "timeStamp", { value: performance.now() });
    return fireEvent(target, event);
  };
  const up = () => {
    const event = new KeyboardEvent("keyup", {
      code: "Space",
      key: " ",
      bubbles: true,
    });
    Object.defineProperty(event, "timeStamp", { value: performance.now() });
    return fireEvent(document, event);
  };

  it.each([100, 400, 799])("does not toggle after %ims", (ms) => {
    const { toggle, result } = setup();
    down();
    expect(result.current).toBe(true);
    advance(ms);
    up();
    advance(2000);
    expect(toggle).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });
  it("toggles at exactly 800ms, only once, and can toggle again after release", () => {
    const { toggle, result } = setup();
    down();
    advance(HOLD_DURATION - 1);
    expect(toggle).not.toHaveBeenCalled();
    advance(1);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(false);
    down(document.body, true);
    advance(5000);
    expect(toggle).toHaveBeenCalledTimes(1);
    up();
    down();
    advance(HOLD_DURATION);
    expect(toggle).toHaveBeenCalledTimes(2);
  });
  it.each(["input", "textarea", "select", "button", "a", "summary"])(
    "preserves native Space on %s",
    (tag) => {
      const { toggle, result } = setup();
      const element = document.createElement(tag);
      if (tag === "a") element.setAttribute("href", "#");
      document.body.append(element);
      expect(down(element)).toBe(true);
      expect(result.current).toBe(false);
      advance(3000);
      expect(toggle).not.toHaveBeenCalled();
    },
  );
  it.each([
    "button",
    "slider",
    "combobox",
    "dialog",
    "menuitem",
    "listbox",
    "checkbox",
    "switch",
    "radio",
    "tab",
    "treeitem",
    "option",
  ])("ignores interactive role %s", (role) => {
    const { toggle } = setup();
    const element = document.createElement("div");
    element.setAttribute("role", role);
    document.body.append(element);
    down(element);
    advance(2000);
    expect(toggle).not.toHaveBeenCalled();
  });
  it("ignores editable children, modifier shortcuts, and already-consumed events", () => {
    const { toggle } = setup();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    editable.append(child);
    document.body.append(editable);
    down(child);
    advance(2000);
    expect(toggle).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { code: "Space", ctrlKey: true });
    advance(2000);
    expect(toggle).not.toHaveBeenCalled();
    const event = new KeyboardEvent("keydown", {
      code: "Space",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    act(() => document.body.dispatchEvent(event));
    advance(2000);
    expect(toggle).not.toHaveBeenCalled();
  });
  it("captures body Space to prevent scrolling", () => {
    setup();
    expect(down()).toBe(false);
  });
  it("does not promote a short physical tap when release delivery is delayed", () => {
    const { toggle } = setup();
    const press = new KeyboardEvent("keydown", {
      code: "Space",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(press, "timeStamp", { value: 100 });
    fireEvent(document.body, press);
    const clock = vi.spyOn(performance, "now").mockReturnValue(1400);
    const release = new KeyboardEvent("keyup", {
      code: "Space",
      bubbles: true,
    });
    Object.defineProperty(release, "timeStamp", { value: 200 });
    fireEvent(document.body, release);
    expect(toggle).not.toHaveBeenCalled();
    clock.mockRestore();
    advance(1000);
    expect(toggle).not.toHaveBeenCalled();
  });
  it.each([800, 1000])(
    "honors a physical %ims hold once if timer delivery was delayed",
    (duration) => {
      const { toggle } = setup();
      const press = new KeyboardEvent("keydown", {
        code: "Space",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(press, "timeStamp", { value: 100 });
      fireEvent(document.body, press);
      const release = new KeyboardEvent("keyup", {
        code: "Space",
        bubbles: true,
      });
      Object.defineProperty(release, "timeStamp", { value: 100 + duration });
      fireEvent(document.body, release);
      advance(2000);
      expect(toggle).toHaveBeenCalledOnce();
    },
  );
  it("keyup after blur cannot revive a canceled gesture", () => {
    const { toggle } = setup();
    down();
    advance(400);
    fireEvent(window, new Event("blur"));
    advance(1000);
    up();
    expect(toggle).not.toHaveBeenCalled();
  });
  it("double tap followed by hold remains one cursor event and one immersive event", () => {
    const { toggle, toggleCursor } = setup(true);
    down();
    advance(60);
    up();
    advance(70);
    down();
    advance(60);
    up();
    down();
    advance(800);
    up();
    expect(toggleCursor).toHaveBeenCalledOnce();
    expect(toggle).toHaveBeenCalledOnce();
  });
  it("uses the latest callbacks across rapid immersive intent changes without duplicating listeners", () => {
    const first = vi.fn(),
      second = vi.fn(),
      exit = vi.fn();
    const { rerender } = renderHook(
      ({ immersive, callback }) => useHoldShortcut(callback, exit, immersive),
      { initialProps: { immersive: false, callback: first } },
    );
    down();
    advance(400);
    rerender({ immersive: true, callback: second });
    advance(400);
    up();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    rerender({ immersive: false, callback: first });
    down();
    advance(800);
    up();
    expect(first).toHaveBeenCalledOnce();
  });
  it("cancels on blur", () => {
    const { toggle, result } = setup();
    down();
    advance(400);
    fireEvent(window, new Event("blur"));
    advance(3000);
    expect(toggle).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });
  it("cancels when hidden", () => {
    const { toggle } = setup();
    down();
    advance(400);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    fireEvent(document, new Event("visibilitychange"));
    advance(3000);
    expect(toggle).not.toHaveBeenCalled();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });
  it("cleans up timers and listeners on unmount", () => {
    const { toggle, unmount } = setup();
    down();
    advance(400);
    unmount();
    advance(3000);
    expect(toggle).not.toHaveBeenCalled();
    down();
    advance(3000);
    expect(toggle).not.toHaveBeenCalled();
  });
  it("lets modal interactions own Escape and otherwise exits immersive mode", () => {
    const { exit } = setup(true);
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    fireEvent.keyDown(document.body, { code: "Escape" });
    expect(exit).not.toHaveBeenCalled();
    dialog.remove();
    fireEvent.keyDown(document.body, { code: "Escape" });
    expect(exit).toHaveBeenCalledOnce();
  });

  it("resolves two short presses as cursor toggle only in immersive mode", () => {
    const { toggle, toggleCursor } = setup(true);
    down();
    advance(50);
    up();
    advance(80);
    down();
    advance(50);
    up();
    expect(toggleCursor).toHaveBeenCalledOnce();
    advance(1000);
    expect(toggle).not.toHaveBeenCalled();
    down();
    advance(30);
    up();
    advance(80);
    down();
    advance(30);
    up();
    expect(toggleCursor).toHaveBeenCalledTimes(2);
  });
  it("does not use double press outside immersive mode or after the window expires", () => {
    const { toggleCursor } = setup(false);
    down();
    advance(30);
    up();
    down();
    advance(30);
    up();
    expect(toggleCursor).not.toHaveBeenCalled();
  });
  it("expires the 350ms double-press window", () => {
    const { toggleCursor } = setup(true);
    down();
    advance(30);
    up();
    advance(DOUBLE_PRESS_WINDOW);
    down();
    advance(30);
    up();
    expect(toggleCursor).not.toHaveBeenCalled();
  });
  it("a long second press is a hold, and long releases never seed a double press", () => {
    const { toggle, toggleCursor } = setup(true);
    down();
    advance(30);
    up();
    advance(40);
    down();
    advance(HOLD_DURATION);
    up();
    expect(toggle).toHaveBeenCalledOnce();
    expect(toggleCursor).not.toHaveBeenCalled();
    down();
    advance(30);
    up();
    expect(toggleCursor).not.toHaveBeenCalled();
  });
  it("clears double-press history on blur and focus changes", () => {
    const { toggleCursor } = setup(true);
    down();
    advance(20);
    up();
    fireEvent(window, new Event("blur"));
    down();
    advance(20);
    up();
    expect(toggleCursor).not.toHaveBeenCalled();
    fireEvent.focusIn(document.body);
    down();
    advance(20);
    up();
    expect(toggleCursor).not.toHaveBeenCalled();
  });
  it("revalidates modal ownership at completion and does not fire if a dialog opens mid-hold", () => {
    const { toggle } = setup();
    down();
    advance(400);
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    advance(500);
    expect(toggle).not.toHaveBeenCalled();
  });
  it("does not capture Space while the document is hidden", () => {
    const { toggle } = setup();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    expect(down()).toBe(true);
    advance(HOLD_DURATION);
    expect(toggle).not.toHaveBeenCalled();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });
  it("coordinates arrow keys only in the active graph context and clears them on blur", () => {
    const { orbit, graphActive } = setup();
    fireEvent.keyDown(document.body, { code: "ArrowLeft" });
    fireEvent.keyDown(document.body, { code: "ArrowLeft", repeat: true });
    expect(orbit).toHaveBeenCalledTimes(1);
    expect(orbit).toHaveBeenLastCalledWith("ArrowLeft", true);
    fireEvent.keyUp(document.body, { code: "ArrowLeft" });
    expect(orbit).toHaveBeenLastCalledWith("ArrowLeft", false);
    graphActive.mockReturnValue(false);
    fireEvent.keyDown(document.body, { code: "ArrowRight" });
    expect(orbit).toHaveBeenCalledTimes(2);
    graphActive.mockReturnValue(true);
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { code: "ArrowRight" });
    expect(orbit).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document.body, { code: "ArrowUp" });
    fireEvent(window, new Event("blur"));
    expect(orbit).toHaveBeenLastCalledWith("ArrowUp", false);
  });
  const chord = (target: Element = document.body, repeat = false) =>
    fireEvent.keyDown(target, {
      code: "Space",
      key: " ",
      ctrlKey: true,
      repeat,
    });
  it.each(["ctrl-first", "space-first"])(
    "Ctrl+Space fires once and ignores %s release order",
    (order) => {
      const { simulation, toggle, toggleCursor, result } = setup(true);
      chord();
      expect(simulation).toHaveBeenCalledOnce();
      expect(result.current).toBe(false);
      chord(document.body, true);
      advance(2000);
      expect(simulation).toHaveBeenCalledOnce();
      if (order === "ctrl-first") {
        fireEvent.keyUp(document, { code: "ControlLeft" });
        up();
      } else {
        fireEvent.keyUp(document, { code: "Space", ctrlKey: true });
        fireEvent.keyUp(document, { code: "ControlLeft" });
      }
      expect(toggle).not.toHaveBeenCalled();
      expect(toggleCursor).not.toHaveBeenCalled();
      down();
      advance(50);
      up();
      expect(toggleCursor).not.toHaveBeenCalled();
      chord();
      expect(simulation).toHaveBeenCalledTimes(2);
    },
  );
  it("Ctrl pressed during held Space cancels the plain gesture without running simulation", () => {
    const { simulation, toggle, toggleCursor } = setup(true);
    down();
    advance(400);
    fireEvent.keyDown(document.body, { code: "ControlLeft", ctrlKey: true });
    advance(1000);
    fireEvent.keyUp(document, { code: "ControlLeft" });
    down(document.body, true);
    advance(1000);
    up();
    expect(simulation).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
    expect(toggleCursor).not.toHaveBeenCalled();
  });
  it.each(["input", "textarea", "select", "button"])(
    "does not invoke Ctrl+Space inside native %s",
    (tag) => {
      const { simulation } = setup();
      const target = document.createElement(tag);
      document.body.append(target);
      chord(target);
      advance(1000);
      up();
      expect(simulation).not.toHaveBeenCalled();
    },
  );
  it("plain Space never activates focused simulation buttons, Ctrl+Space still works there", () => {
    const { simulation, toggle } = setup();
    const target = document.createElement("button");
    target.dataset.simulationControl = "true";
    document.body.append(target);
    expect(down(target)).toBe(false);
    advance(1000);
    up();
    expect(simulation).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
    chord(target);
    expect(simulation).toHaveBeenCalledOnce();
  });
  it("dialogs, editable content, blur, hidden state and cleanup keep Ctrl+Space isolated", () => {
    const { simulation, toggle, unmount } = setup();
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    editable.setAttribute("contenteditable", "true");
    document.body.append(editable);
    chord(editable);
    up();
    expect(simulation).not.toHaveBeenCalled();
    const dialog = document.createElement("dialog");
    dialog.open = true;
    document.body.append(dialog);
    chord();
    up();
    expect(simulation).not.toHaveBeenCalled();
    dialog.remove();
    chord();
    fireEvent(window, new Event("blur"));
    up();
    advance(1000);
    expect(simulation).toHaveBeenCalledOnce();
    expect(toggle).not.toHaveBeenCalled();
    unmount();
    chord();
    expect(simulation).toHaveBeenCalledOnce();
  });
  it("modified Space is ignored while hidden and does not arm a later plain hold after focus changes", () => {
    const { simulation, toggle } = setup();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    chord();
    up();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    expect(simulation).not.toHaveBeenCalled();
    chord();
    fireEvent.focusIn(document.body);
    fireEvent.keyUp(document, { code: "ControlLeft" });
    down(document.body, true);
    advance(1000);
    up();
    expect(simulation).toHaveBeenCalledOnce();
    expect(toggle).not.toHaveBeenCalled();
  });
});
