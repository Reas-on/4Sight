import { useEffect, useRef, useState } from "react";

export const HOLD_DURATION = 800;
export const DOUBLE_PRESS_WINDOW = 350;
export const HOLD_HINT = `${HOLD_DURATION / 1000}s`;
export type OrbitKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
export type CursorMode = "visible" | "hidden";
type GraphShortcuts = {
  toggleCursor?: () => void;
  orbit?: (key: OrbitKey, pressed: boolean) => void;
  graphActive?: () => boolean;
  simulation?: () => void;
  resultsOpen?: boolean;
  closeResults?: () => void;
};
const interactive =
  'input,textarea,select,button,a[href],summary,audio[controls],video[controls],[contenteditable]:not([contenteditable="false"]),[role="button"],[role="slider"],[role="textbox"],[role="combobox"],[role="menu"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="listbox"],[role="option"],[role="checkbox"],[role="switch"],[role="radio"],[role="tab"],[role="tree"],[role="treeitem"],[role="spinbutton"],[role="dialog"],dialog,[tabindex]:not([tabindex="-1"])';

export function useHoldShortcut(
  toggle: () => void,
  exit: () => void,
  isImmersive: boolean,
  shortcuts: GraphShortcuts = {},
) {
  const actions = useRef({ toggle, exit, isImmersive, ...shortcuts });
  actions.current = { toggle, exit, isImmersive, ...shortcuts };
  const [holding, setHolding] = useState(false);
  useEffect(() => {
    let started: number | null = null;
    let eventStarted: number | null = null;
    let physicalDown = false;
    let generation = 0;
    let fired = false;
    let firstPress: number | null = null;
    let firstReleased: number | null = null;
    let secondPress = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let spaceDown = false;
    let blockedUntilRelease = false;
    const orbitKeys = new Set<OrbitKey>();
    const modalOwnsKeys = () =>
      !!document.querySelector(
        'dialog[open],[aria-modal="true"],[role="menu"]',
      );
    const owned = (target: Element | null) =>
      !!(
        target?.closest(interactive) &&
        !target.closest('[data-graph-keyboard="true"]')
      ) || modalOwnsKeys();
    const resetPress = () => {
      physicalDown = false;
      eventStarted = null;
      generation++;
      started = null;
      fired = false;
      secondPress = false;
      clearTimeout(timer);
      setHolding(false);
    };
    const cancel = () => {
      resetPress();
      firstPress = null;
      firstReleased = null;
      orbitKeys.forEach((key) => actions.current.orbit?.(key, false));
      orbitKeys.clear();
    };
    const cancelPlainGesture = () => {
      resetPress();
      firstPress = null;
      firstReleased = null;
    };
    const complete = (token: number) => {
      if (!physicalDown || token !== generation || started === null || fired)
        return;
      const target = document.activeElement;
      if (document.hidden || owned(target)) {
        cancel();
        return;
      }
      const remaining = HOLD_DURATION - (performance.now() - started);
      if (remaining > 0) {
        timer = setTimeout(() => complete(token), remaining);
        return;
      }
      fired = true;
      firstPress = null;
      firstReleased = null;
      setHolding(false);
      actions.current.toggle();
    };
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // Modifier changes invalidate a pending plain-Space gesture, but do not
      // turn that same physical press into a simulation action.
      if (
        [
          "ControlLeft",
          "ControlRight",
          "AltLeft",
          "AltRight",
          "MetaLeft",
          "MetaRight",
          "ShiftLeft",
          "ShiftRight",
        ].includes(event.code)
      ) {
        cancelPlainGesture();
        if (spaceDown) blockedUntilRelease = true;
      }
      if (event.code === "Space") {
        const alreadyDown = spaceDown;
        spaceDown = true;
        if (event.repeat || alreadyDown) {
          if (
            (!owned(target) ||
              target?.closest('[data-simulation-control="true"]')) &&
            !event.defaultPrevented
          )
            event.preventDefault();
          return;
        }
        if (blockedUntilRelease) return;
        if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
          cancelPlainGesture();
          blockedUntilRelease = true;
          const simulationControl = target?.closest(
            '[data-simulation-control="true"]',
          );
          const canCapture =
            !owned(target) ||
            (!!simulationControl && !modalOwnsKeys()) ||
            (!!target?.closest('[data-results-panel="true"]') &&
              !target.closest(
                'input,textarea,select,[contenteditable="true"]',
              ) &&
              !modalOwnsKeys());
          if (
            event.ctrlKey &&
            !event.altKey &&
            !event.metaKey &&
            !event.shiftKey &&
            canCapture &&
            !document.hidden &&
            !event.defaultPrevented &&
            !event.isComposing
          ) {
            event.preventDefault();
            actions.current.simulation?.();
          }
          return;
        }
        // Plain Space retains graph gestures, but never performs a native click
        // on a focused simulation control. Enter/click still activate buttons.
        if (target?.closest('[data-simulation-control="true"]')) {
          cancelPlainGesture();
          blockedUntilRelease = true;
          event.preventDefault();
          return;
        }
      }
      if (event.defaultPrevented || event.isComposing || document.hidden)
        return;
      if (
        event.code === "Escape" &&
        actions.current.resultsOpen &&
        !modalOwnsKeys()
      ) {
        event.preventDefault();
        cancel();
        actions.current.closeResults?.();
        return;
      }
      if (event.code === "Escape" && actions.current.isImmersive) {
        if (
          target?.closest(
            'dialog,[role="dialog"],[role="menu"],[role="listbox"]',
          ) ||
          document.querySelector(
            'dialog[open],[aria-modal="true"],[role="menu"]',
          )
        )
          return;
        event.preventDefault();
        cancel();
        actions.current.exit();
        return;
      }
      if (event.code.startsWith("Arrow")) {
        if (
          owned(target) ||
          !actions.current.graphActive?.() ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        )
          return;
        const key = event.code as OrbitKey;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key))
          return;
        event.preventDefault();
        if (!orbitKeys.has(key)) {
          orbitKeys.add(key);
          actions.current.orbit?.(key, true);
        }
        return;
      }
      if (
        event.code !== "Space" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        owned(target)
      )
        return;
      event.preventDefault();
      if (event.repeat || physicalDown) return;
      physicalDown = true;
      eventStarted = event.timeStamp;
      const token = ++generation;
      started = performance.now();
      fired = false;
      secondPress =
        actions.current.isImmersive &&
        firstPress !== null &&
        firstReleased !== null &&
        event.timeStamp - firstPress <= DOUBLE_PRESS_WINDOW;
      if (!secondPress) {
        firstPress = null;
        firstReleased = null;
      }
      setHolding(true);
      timer = setTimeout(() => complete(token), HOLD_DURATION);
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code.startsWith("Arrow")) {
        const key = event.code as OrbitKey;
        if (orbitKeys.delete(key)) actions.current.orbit?.(key, false);
        return;
      }
      if (event.code !== "Space") return;
      spaceDown = false;
      if (
        blockedUntilRelease ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        blockedUntilRelease = false;
        cancelPlainGesture();
        return;
      }
      if (!physicalDown || started === null) return;
      const now = event.timeStamp;
      const target = event.target instanceof Element ? event.target : null;
      // Event timestamps describe the physical press even if rendering delays
      // delivery of keyup. Delivery-time elapsed must never promote a short tap.
      const duration =
        eventStarted === null ? 0 : Math.max(0, event.timeStamp - eventStarted);
      const wasFired = fired;
      const wasSecond = secondPress;
      const pressStarted = eventStarted ?? event.timeStamp;
      physicalDown = false;
      clearTimeout(timer);
      generation++;
      if (
        !wasFired &&
        duration >= HOLD_DURATION &&
        !owned(target) &&
        !document.hidden &&
        !event.defaultPrevented
      ) {
        fired = true;
        actions.current.toggle();
      }
      if (
        !wasFired &&
        duration < HOLD_DURATION &&
        !owned(target) &&
        actions.current.isImmersive
      ) {
        if (
          wasSecond &&
          firstReleased !== null &&
          now - firstReleased <= DOUBLE_PRESS_WINDOW
        ) {
          actions.current.toggleCursor?.();
          firstPress = null;
          firstReleased = null;
        } else {
          firstPress = pressStarted;
          firstReleased = now;
        }
      } else {
        firstPress = null;
        firstReleased = null;
      }
      resetPress();
    };
    const visibility = () => {
      if (document.hidden) blur();
    };
    const blur = () => {
      cancel();
      spaceDown = false;
      blockedUntilRelease = false;
    };
    // Bubble phase lets focused controls and higher-priority interactions consume keys first.
    document.addEventListener("keydown", keydown);
    document.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("focusin", cancel);
    return () => {
      cancel();
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("focusin", cancel);
    };
  }, []);
  return holding;
}
