/** Minimal distinct-node Web Audio fake for world-audio bus/ambience/music tests. */
export class FakeParam {
  value: number;
  events: [string, number, number][] = [];
  constructor(value = 1) { this.value = value; }
  setTargetAtTime(value: number, time: number): void { this.events.push(["target", value, time]); this.value = value; }
  linearRampToValueAtTime(value: number, time: number): void { this.events.push(["ramp", value, time]); this.value = value; }
  setValueAtTime(value: number, time: number): void { this.events.push(["set", value, time]); }
  /** Web Audio semantics: removes every event whose time >= `time` (a ramp's time is its end). */
  cancelScheduledValues(time: number): void {
    this.events = this.events.filter(([type, , at]) => type === "cancel" || at < time);
    this.events.push(["cancel", 0, time]);
  }
  /** Scheduled (non-cancel) events still pending at or after `time`. */
  pending(time: number): [string, number, number][] { return this.events.filter(([type, , at]) => type !== "cancel" && at >= time); }
}

export class FakeNode {
  constructor(readonly kind: string) {}
  connections: FakeNode[] = [];
  connect(destination: FakeNode): void { this.connections.push(destination); }
  disconnect(): void { this.connections = []; }
}

export class FakeGainNode extends FakeNode { gain = new FakeParam(1); constructor() { super("gain"); } }

export class FakeAnalyserNode extends FakeNode {
  fftSize = 2048;
  level = .25;
  constructor() { super("analyser"); }
  getFloatTimeDomainData(target: Float32Array): void { target.fill(this.level); }
}

export class FakeCompressorNode extends FakeNode {
  threshold = new FakeParam(-24); knee = new FakeParam(30); ratio = new FakeParam(12);
  attack = new FakeParam(.003); release = new FakeParam(.25); reduction = -1.5;
  constructor() { super("compressor"); }
}

export class FakePannerNode extends FakeNode {
  panningModel = ""; distanceModel = ""; rolloffFactor = 1; refDistance = 1; maxDistance = 1;
  positionX = new FakeParam(0); positionY = new FakeParam(0); positionZ = new FakeParam(0);
  constructor() { super("panner"); }
}

export class FakeBufferSource extends FakeNode {
  buffer: { duration: number } | null = null;
  loop = false;
  playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  starts: [number, number][] = [];
  stops: (number | undefined)[] = [];
  constructor() { super("source"); }
  start(time: number, offset: number): void { this.starts.push([time, offset]); }
  stop(time?: number): void { this.stops.push(time); }
  end(): void { this.onended?.(); }
}

export class FakeMediaSource extends FakeNode { constructor(readonly element: FakeMediaElement) { super("media"); } }

/** HTMLMediaElement subset driven by worldMusic. */
export class FakeMediaElement {
  src = "";
  preload = "";
  loop = true;
  currentTime = 0;
  paused = true;
  plays: string[] = [];
  pauses = 0;
  loads = 0;
  refuse: string | null = null;
  private listeners = new Map<string, (() => void)[]>();
  play(): Promise<void> {
    this.plays.push(this.src);
    if (this.refuse) { const name = this.refuse; return Promise.reject(Object.assign(new Error(name), { name })); }
    this.paused = false; return Promise.resolve();
  }
  pause(): void { this.paused = true; this.pauses++; }
  load(): void { this.loads++; }
  removeAttribute(name: string): void { if (name === "src") this.src = ""; }
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    options?.signal?.addEventListener("abort", () => this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener)));
  }
  fire(type: "ended" | "error"): void { if (type === "ended") this.paused = true; for (const listener of this.listeners.get(type) ?? []) listener(); }
}

export class FakeAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 10;
  destination = new FakeNode("destination");
  listener = { positionX: new FakeParam(0), positionY: new FakeParam(0), positionZ: new FakeParam(0),
    forwardX: new FakeParam(0), forwardY: new FakeParam(0), forwardZ: new FakeParam(-1),
    upX: new FakeParam(0), upY: new FakeParam(1), upZ: new FakeParam(0) };
  gains: FakeGainNode[] = [];
  analysers: FakeAnalyserNode[] = [];
  compressors: FakeCompressorNode[] = [];
  sources: FakeBufferSource[] = [];
  panners: FakePannerNode[] = [];
  media: FakeMediaSource[] = [];
  resumes = 0;
  decodes = 0;
  durations = new Map<number, number>();
  failDecode = new Set<number>();
  /** When false, resume() stays pending until settleResume(). */
  autoResume = true;
  private pendingResume: (() => void) | null = null;
  private stateListeners: (() => void)[] = [];
  resume(): Promise<void> {
    this.resumes++;
    if (this.autoResume) { this.state = "running"; return Promise.resolve(); }
    return new Promise(resolve => { this.pendingResume = () => { this.state = "running"; resolve(); }; });
  }
  settleResume(): void { this.pendingResume?.(); this.pendingResume = null; this.emitState(); }
  close(): Promise<void> { this.state = "closed"; return Promise.resolve(); }
  addEventListener(type: string, listener: () => void): void { if (type === "statechange") this.stateListeners.push(listener); }
  emitState(): void { for (const listener of this.stateListeners) listener(); }
  createGain(): FakeGainNode { const node = new FakeGainNode(); this.gains.push(node); return node; }
  createAnalyser(): FakeAnalyserNode { const node = new FakeAnalyserNode(); this.analysers.push(node); return node; }
  createDynamicsCompressor(): FakeCompressorNode { const node = new FakeCompressorNode(); this.compressors.push(node); return node; }
  createPanner(): FakePannerNode { const node = new FakePannerNode(); this.panners.push(node); return node; }
  createBufferSource(): FakeBufferSource { const node = new FakeBufferSource(); this.sources.push(node); return node; }
  createMediaElementSource(element: FakeMediaElement): FakeMediaSource { const node = new FakeMediaSource(element); this.media.push(node); return node; }
  /** First byte selects the decoded duration (seconds) or a failure. */
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    this.decodes++;
    const first = new Uint8Array(bytes)[0] ?? 0;
    if (this.failDecode.has(first)) return Promise.reject(new Error("unsupported codec"));
    return Promise.resolve({ duration: this.durations.get(first) ?? 2 } as AudioBuffer);
  }
}

export function fakeMixerContext() {
  const context = new FakeAudioContext();
  return { context, makeContext: () => context as unknown as AudioContext };
}

export async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
