import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { INTRO_TIMELINE, type IntroStage } from "../data/intro";

export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return reduced;
}

export type MotionPhase =
  "intro" | "normal" | "entering" | "immersive" | "exiting";

export function useMotion(reduced: boolean) {
  const [isImmersive, setImmersive] = useState(false);
  const [introComplete, setIntroComplete] = useState(reduced);
  const [introStartedAt] = useState(() => performance.now());
  const [introStage, setIntroStage] = useState<IntroStage>(
    reduced ? "complete" : "background",
  );
  const [phase, setPhase] = useState<MotionPhase>(reduced ? "normal" : "intro");
  const previousImmersive = useRef(false);
  const requestImmersive = useCallback((next: SetStateAction<boolean>) => {
    // Explicit interaction completes decorative initialization immediately.
    setIntroComplete(true);
    setImmersive(next);
  }, []);
  useEffect(() => {
    if (introComplete || reduced) {
      setIntroStage("complete");
      setIntroComplete(true);
      return;
    }
    const timers = Object.entries(INTRO_TIMELINE).map(([stage, offset]) =>
      window.setTimeout(
        () => {
          setIntroStage(stage as IntroStage);
          if (stage === "complete") setIntroComplete(true);
        },
        Math.max(0, introStartedAt + offset - performance.now()),
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [introComplete, reduced, introStartedAt]);
  useEffect(() => {
    if (!introComplete) {
      setPhase("intro");
      return;
    }
    if (previousImmersive.current === isImmersive) {
      setPhase(isImmersive ? "immersive" : "normal");
      return;
    }
    previousImmersive.current = isImmersive;
    setPhase(isImmersive ? "entering" : "exiting");
    const timer = window.setTimeout(
      () => setPhase(isImmersive ? "immersive" : "normal"),
      reduced ? 0 : 560,
    );
    return () => clearTimeout(timer);
  }, [isImmersive, introComplete, reduced]);
  return {
    isImmersive,
    setImmersive: requestImmersive,
    introComplete,
    introStartedAt,
    introStage,
    phase,
  };
}
