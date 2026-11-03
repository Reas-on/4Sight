import { useCallback, useEffect, useRef, useState } from "react";
import type { IntroStage } from "../data/intro";
import {
  GraphAudioEngine,
  type AudioEvent,
  type AudioState,
} from "../audio/GraphAudioEngine";

export const DEFAULT_SOUND_ENABLED = true;
const SOUND_PREFERENCE = "4sight-intro-sound";
/** Shared sound lifecycle; one context survives graph/UI mode changes. */
export function useIntroSound(
  stage: IntroStage,
  startedAt: number,
  reduced: boolean,
) {
  const [soundEnabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(SOUND_PREFERENCE) === "off"
        ? false
        : DEFAULT_SOUND_ENABLED;
    } catch {
      return DEFAULT_SOUND_ENABLED;
    }
  });
  const [audioState, setAudioState] = useState<AudioState>("waiting");
  const engine = useRef<GraphAudioEngine | null>(null);
  const latest = useRef({ soundEnabled, reduced, startedAt, stage });
  latest.current = { soundEnabled, reduced, startedAt, stage };
  useEffect(() => {
    const audio = new GraphAudioEngine(setAudioState);
    engine.current = audio;
    const unlock = (event: Event) => {
      if (
        event instanceof KeyboardEvent &&
        (event.repeat ||
          event.isComposing ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey)
      )
        return;
      if (event.isTrusted) audio.ensure(true);
    };
    const visibility = () => audio.setHidden(document.hidden);
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("pointerup", unlock);
    document.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("pointerup", unlock);
      document.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", visibility);
      audio.dispose();
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    engine.current?.configure(
      soundEnabled,
      reduced,
      startedAt,
      stage === "complete",
    );
  }, [soundEnabled, reduced, startedAt, stage]);
  const toggleSound = useCallback(() => {
    const enabled = !latest.current.soundEnabled;
    latest.current.soundEnabled = enabled;
    setEnabled(enabled);
    try {
      localStorage.setItem(SOUND_PREFERENCE, enabled ? "on" : "off");
    } catch {
      /* Optional persistence. */
    }
    engine.current?.configure(
      enabled,
      latest.current.reduced,
      latest.current.startedAt,
      latest.current.stage === "complete",
    );
    if (enabled) engine.current?.ensure(true);
  }, []);
  const emitAudio = useCallback(
    (event: AudioEvent, pan = 0) => engine.current?.emit(event, pan),
    [],
  );
  const stopSimulationAudio = useCallback(
    () => engine.current?.stopSimulation(),
    [],
  );
  return {
    soundEnabled,
    toggleSound,
    audioState,
    emitAudio,
    stopSimulationAudio,
  };
}
