import { INTRO_TIMELINE } from "../data/intro";

export type AudioEvent =
  | "INTRO_START"
  | "INTRO_COMPLETE"
  | "NODE_SELECTED"
  | "NODE_NAVIGATED"
  | "NODE_ENTERED"
  | "NODE_COMPLETED"
  | "NODE_FAILED"
  | "NODE_INTERCEPTED"
  | "SIMULATION_COMPLETED";
export type AudioState =
  "waiting" | "playing" | "muted" | "reduced-motion" | "unavailable" | "hidden";
type Layer = "intro" | "ambient" | "interaction" | "simulation";
type Voice = {
  source: OscillatorNode | AudioBufferSourceNode;
  nodes: AudioNode[];
  layer: Layer;
  group: string;
};
export const AUDIO_MIX = {
  ambient: 0.32,
  interaction: 0.36,
  simulation: 0.3,
  intro: 0.4,
  master: 0.65,
} as const;
const log = (message: string, detail?: unknown) => {
  if (import.meta.env.DEV)
    console.info(`[4Sight audio] ${message}`, detail ?? "");
};
const warn = (message: string, error: unknown) => {
  if (import.meta.env.DEV) console.warn(`[4Sight audio] ${message}`, error);
};

/** One context/mixer; continuous ambience and bounded, event-driven transient voices. */
export class GraphAudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private layers: Record<Layer, GainNode> | null = null;
  private permanent: AudioNode[] = [];
  private voices = new Set<Voice>();
  private introScheduled = new Set<string>();
  private enabled = true;
  private reduced = false;
  private hidden = false;
  private disposed = false;
  private resuming = false;
  private suspendTimer: ReturnType<typeof setTimeout> | undefined;
  private sequence = 0;
  private introStartedAt = 0;
  private introComplete = false;
  private ambientStarted = false;
  private lastInteraction = -Infinity;

  constructor(private onState: (state: AudioState) => void) {}
  configure(
    enabled: boolean,
    reduced: boolean,
    startedAt: number,
    complete: boolean,
  ) {
    if (this.introStartedAt !== startedAt) {
      this.stopLayer("intro");
      this.introScheduled.clear();
      this.introStartedAt = startedAt;
    }
    this.enabled = enabled;
    this.reduced = reduced;
    this.introComplete = complete;
    if (complete) this.stopLayer("intro");
    if (!enabled || reduced) {
      this.fadeOut(!enabled ? "muted" : "reduced-motion");
      return;
    }
    this.ensure(false);
  }
  private initialize() {
    if (this.context) return;
    const audio = new AudioContext();
    this.context = audio;
    const master = audio.createGain();
    master.gain.value = 0;
    this.master = master;
    const compressor = audio.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.015;
    compressor.release.value = 0.25;
    master.connect(compressor);
    compressor.connect(audio.destination);
    this.layers = {
      intro: audio.createGain(),
      ambient: audio.createGain(),
      interaction: audio.createGain(),
      simulation: audio.createGain(),
    };
    for (const layer of Object.keys(this.layers) as Layer[]) {
      this.layers[layer].gain.value = AUDIO_MIX[layer];
      this.layers[layer].connect(master);
    }
    this.permanent.push(master, compressor, ...Object.values(this.layers));
    audio.onstatechange = () => {
      log("AudioContext state", audio.state);
      if (
        audio.state === "running" &&
        this.enabled &&
        !this.hidden &&
        !this.disposed &&
        !this.reduced
      )
        this.activate();
    };
    log("AudioContext created", audio.state);
  }
  ensure(fromGesture: boolean) {
    if (this.disposed || !this.enabled || this.reduced || this.hidden) return;
    if (typeof AudioContext === "undefined") {
      this.onState("unavailable");
      return;
    }
    try {
      this.initialize();
      const audio = this.context!;
      if (audio.state === "running") {
        this.activate();
        return;
      }
      this.onState("waiting");
      if (!fromGesture || this.resuming) return;
      this.resuming = true;
      const token = this.sequence;
      void audio
        .resume()
        .then(() => {
          if (!this.disposed && token === this.sequence) this.activate();
        })
        .catch((error) => {
          if (!this.disposed) {
            this.onState("waiting");
            warn("Playback blocked; visual application remains active", error);
          }
        })
        .finally(() => {
          this.resuming = false;
        });
    } catch (error) {
      this.onState("unavailable");
      warn("Audio initialization failed", error);
    }
  }
  private activate() {
    if (
      !this.context ||
      !this.master ||
      !this.enabled ||
      this.hidden ||
      this.reduced ||
      this.disposed
    )
      return;
    clearTimeout(this.suspendTimer);
    const gain = this.master.gain,
      now = this.context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(AUDIO_MIX.master, now, 0.35);
    if (!this.ambientStarted) this.startAmbient();
    this.scheduleIntro();
    this.onState("playing");
  }
  private track(
    source: Voice["source"],
    nodes: AudioNode[],
    layer: Layer,
    group: string,
  ) {
    const voice = { source, nodes, layer, group };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect();
      nodes.forEach((node) => node.disconnect());
      this.voices.delete(voice);
    };
  }
  private stopVoice(voice: Voice) {
    try {
      voice.source.stop();
    } catch {
      /* Already ended. */
    }
    voice.source.disconnect();
    voice.nodes.forEach((node) => node.disconnect());
    this.voices.delete(voice);
  }
  private stopLayer(layer: Layer) {
    for (const voice of [...this.voices])
      if (voice.layer === layer) this.stopVoice(voice);
  }
  stopSimulation() {
    this.stopLayer("simulation");
  }
  private stopGroup(group: string) {
    for (const voice of [...this.voices])
      if (voice.group === group) this.stopVoice(voice);
  }
  private tone(
    layer: Layer,
    group: string,
    frequency: number,
    delay: number,
    duration: number,
    volume: number,
    pan = 0,
    endFrequency = frequency,
  ) {
    const audio = this.context!,
      oscillator = audio.createOscillator(),
      gain = audio.createGain(),
      panner = audio.createStereoPanner();
    const at = audio.currentTime + delay;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(
      endFrequency,
      at + duration,
    );
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    panner.pan.setValueAtTime(pan, at);
    panner.pan.linearRampToValueAtTime(-pan * 0.5, at + duration);
    oscillator.connect(gain);
    gain.connect(panner);
    panner.connect(this.layers![layer]);
    this.track(oscillator, [gain, panner], layer, group);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }
  private startAmbient() {
    const audio = this.context!;
    this.ambientStarted = true;
    const filter = audio.createBiquadFilter(),
      highpass = audio.createBiquadFilter(),
      panner = audio.createStereoPanner(),
      level = audio.createGain();
    filter.type = "lowpass";
    filter.frequency.value = 650;
    filter.Q.value = 0.3;
    highpass.type = "highpass";
    highpass.frequency.value = 65;
    level.gain.value = 0.09;
    highpass.connect(filter);
    filter.connect(level);
    level.connect(panner);
    panner.connect(this.layers!.ambient);
    this.permanent.push(filter, highpass, panner, level);
    for (const [frequency, volume] of [
      [82.41, 0.18],
      [123.47, 0.1],
      [164.82, 0.045],
    ]) {
      const source = audio.createOscillator(),
        gain = audio.createGain();
      source.frequency.value = frequency;
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(highpass);
      this.track(source, [gain], "ambient", "ambient");
      source.start();
    }
    const buffer = audio.createBuffer(
        1,
        audio.sampleRate * 4,
        audio.sampleRate,
      ),
      data = buffer.getChannelData(0);
    let seed = 42,
      previous = 0;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      previous = previous * 0.95 + ((seed / 0xffffffff) * 2 - 1) * 0.05;
      data[i] = previous;
    }
    const seam = Math.floor(audio.sampleRate * 0.1);
    for (let i = 0; i < seam; i++) {
      const t = i / (seam - 1);
      data[data.length - seam + i] =
        data[data.length - seam + i] * (1 - t) + data[0] * t;
    }
    const noise = audio.createBufferSource(),
      noiseGain = audio.createGain();
    noise.buffer = buffer;
    noise.loop = true;
    noiseGain.gain.value = 0.08;
    noise.connect(noiseGain);
    noiseGain.connect(highpass);
    this.track(noise, [noiseGain], "ambient", "ambient");
    noise.start();
    const modulate = (
      frequency: number,
      amount: number,
      destination: AudioParam,
    ) => {
      const lfo = audio.createOscillator(),
        gain = audio.createGain();
      lfo.frequency.value = frequency;
      gain.gain.value = amount;
      lfo.connect(gain);
      gain.connect(destination);
      this.track(lfo, [gain], "ambient", "ambient");
      lfo.start();
    };
    modulate(0.027, 0.3, panner.pan);
    modulate(0.019, 120, filter.frequency);
    modulate(0.041, 0.018, level.gain);
    log("Ambient layer started");
  }
  private scheduleIntro() {
    if (this.introComplete) return;
    const elapsed = performance.now() - this.introStartedAt;
    const cues = [
      ["INTRO_START", INTRO_TIMELINE.background, 146.83],
      ["nodes", INTRO_TIMELINE.nodes, 220],
      ["edges", INTRO_TIMELINE.edges, 293.66],
      ["INTRO_COMPLETE", INTRO_TIMELINE.formation, 329.63],
    ] as const;
    for (const [event, offset, frequency] of cues) {
      const delay = offset - elapsed;
      if (delay < -180 || this.introScheduled.has(event)) continue;
      this.introScheduled.add(event);
      const seconds = Math.max(0, delay / 1000);
      this.tone("intro", "intro", frequency, seconds, 0.45, 0.14, -0.15);
      if (event === "INTRO_COMPLETE")
        this.tone("intro", "intro", 440, seconds + 0.1, 0.35, 0.08, 0.15);
      log("Scheduled intro cue", { event, delayMs: Math.max(0, delay) });
    }
  }
  emit(event: AudioEvent, pan = 0) {
    if (
      !this.enabled ||
      this.hidden ||
      this.reduced ||
      this.disposed ||
      this.context?.state !== "running"
    )
      return;
    if (event === "INTRO_START" || event === "INTRO_COMPLETE") return;
    if (event === "NODE_SELECTED" || event === "NODE_NAVIGATED") {
      if (performance.now() - this.lastInteraction < 45) return;
      this.lastInteraction = performance.now();
      this.stopGroup("interaction");
      this.tone(
        "interaction",
        "interaction",
        event === "NODE_SELECTED" ? 293.66 : 196,
        0,
        event === "NODE_SELECTED" ? 0.24 : 0.4,
        0.16,
        pan,
        event === "NODE_SELECTED" ? 329.63 : 293.66,
      );
    } else {
      if (
        [...this.voices].filter((voice) => voice.layer === "simulation")
          .length > 8
      )
        this.stopLayer("simulation");
      if (event === "NODE_ENTERED")
        this.tone("simulation", event, 196, 0, 0.25, 0.13, pan, 220);
      else if (event === "NODE_COMPLETED" || event === "SIMULATION_COMPLETED") {
        this.tone("simulation", event, 261.63, 0, 0.3, 0.12, pan);
        this.tone(
          "simulation",
          event,
          event === "SIMULATION_COMPLETED" ? 392 : 329.63,
          0.09,
          0.35,
          0.1,
          -pan,
        );
      } else if (event === "NODE_FAILED" || event === "NODE_INTERCEPTED") {
        this.tone(
          "simulation",
          event,
          event === "NODE_FAILED" ? 220 : 246.94,
          0,
          0.3,
          0.12,
          pan,
        );
        this.tone(
          "simulation",
          event,
          event === "NODE_FAILED" ? 164.81 : 196,
          0.08,
          0.4,
          0.1,
          -pan,
        );
      }
    }
    log("Event", event);
  }
  private fadeOut(state: AudioState) {
    this.sequence++;
    this.onState(state);
    clearTimeout(this.suspendTimer);
    this.stopLayer("intro");
    this.stopLayer("interaction");
    this.stopLayer("simulation");
    if (this.master && this.context) {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(0, now, 0.08);
      this.suspendTimer = setTimeout(() => {
        if (this.context?.state === "running")
          void this.context
            .suspend()
            .catch((error) => warn("Suspend failed", error));
      }, 450);
    }
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    if (hidden) this.fadeOut("hidden");
    else if (this.enabled && !this.reduced) this.ensure(true);
  }
  dispose() {
    this.disposed = true;
    this.sequence++;
    clearTimeout(this.suspendTimer);
    for (const voice of [...this.voices]) this.stopVoice(voice);
    this.permanent.forEach((node) => node.disconnect());
    this.permanent = [];
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch((error) => warn("Close failed", error));
    }
    this.context = null;
  }
}
