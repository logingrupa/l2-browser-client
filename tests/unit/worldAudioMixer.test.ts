import { describe, expect, it } from "vitest";
import { WorldAudioMixer } from "../../src/audio/WorldAudioMixer";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakeNode {
  connections: unknown[] = [];
  disconnects = 0;
  connect(destination: unknown): void { this.connections.push(destination); }
  disconnect(destination?: unknown): void {
    this.disconnects++;
    this.connections = destination ? this.connections.filter(value => value !== destination) : [];
  }
}

class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  loop = true;
  onended: (() => void) | null = null;
  starts: [number, number][] = [];
  stops = 0;
  failStart = false;
  failStop = false;
  start(time: number, offset: number): void {
    if (this.failStart) throw new Error("start failure");
    this.starts.push([time, offset]);
  }
  stop(): void { this.stops++; if (this.failStop) throw new Error("already ended"); }
  end(): void { this.onended?.(); }
}

class FakeGain extends FakeNode { gain = { value: 1 }; }

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  samples = [.5, -.25];
  constructor(private readonly gain: FakeGain) { super(); }
  getFloatTimeDomainData(destination: Float32Array): void {
    for (let i = 0; i < destination.length; i++) destination[i] = this.samples[i % this.samples.length]! * this.gain.gain.value;
  }
}

class FakeCapture extends FakeNode {
  trackStops = 0;
  stream = { getTracks: () => [{ stop: () => { this.trackStops++; } }] };
}

class FakeContext {
  state: AudioContextState = "suspended";
  currentTime = 12.5;
  destination = {};
  gain = new FakeGain();
  analyser = new FakeAnalyser(this.gain);
  capture = new FakeCapture();
  captureCalls = 0;
  createdSources: FakeSource[] = [];
  decodedArguments: ArrayBuffer[] = [];
  sequence: string[] = [];
  resumes = 0;
  closes = 0;
  failStart = false;
  failGain = false;
  decode: (bytes: ArrayBuffer) => Promise<AudioBuffer> = async () => ({ duration: 2 }) as AudioBuffer;
  resumeAction: () => Promise<void> = () => { this.state = "running"; return Promise.resolve(); };
  createGain(): FakeGain { if (this.failGain) throw new Error("graph failure"); return this.gain; }
  createAnalyser: (() => FakeAnalyser) | undefined = () => this.analyser;
  createMediaStreamDestination(): FakeCapture { this.captureCalls++; return this.capture; }
  resume(): Promise<void> { this.sequence.push("resume"); this.resumes++; return this.resumeAction(); }
  close(): Promise<void> { this.closes++; this.state = "closed"; return Promise.resolve(); }
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    this.sequence.push("decode");
    this.decodedArguments.push(bytes);
    return this.decode(bytes);
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    source.failStart = this.failStart;
    this.createdSources.push(source);
    return source;
  }
}

function fixture(options: { maxActiveSources?: number; maxCatchupOffsetSeconds?: number } = {}) {
  const context = new FakeContext();
  let created = 0;
  const mixer = new WorldAudioMixer({ ...options, makeContext: () => {
    created++; context.sequence.push("create"); return context as unknown as AudioContext;
  } });
  return { context, mixer, created: () => created };
}

describe("world source-cue preview mixer", () => {
  it("creates and resumes synchronously in the trusted call, before decoding or awaiting", async () => {
    const { mixer, context, created } = fixture();
    mixer.register("original.wav", new Uint8Array([1, 2, 3]));
    expect(mixer.captureStream()).toBeNull();
    expect(created()).toBe(0);
    expect(mixer.inspection().state).toBe("locked");
    const pending = mixer.unlock();
    expect(created()).toBe(1);
    expect(context.sequence).toEqual(["create", "resume"]);
    expect(mixer.inspection().state).toBe("unlocking");
    await pending;
    expect(context.sequence).toEqual(["create", "resume", "decode"]);
    expect(mixer.inspection()).toMatchObject({ state: "running", decoded: 1, decoding: 0 });
    expect(mixer.play("original.wav", "actor-1", .125)).toEqual({
      id: 1, key: "original.wav", owner: "actor-1", contextTime: 12.5, offsetSeconds: .125, durationSeconds: 2,
    });
    expect(context.createdSources[0]!.starts).toEqual([[12.5, .125]]);
    expect(context.createdSources[0]!.loop).toBe(false);
    mixer.dispose();
  });

  it("owns copied input bytes, rejects identity replacement, and retries a failed/detached decode", async () => {
    const { mixer, context } = fixture();
    const original = new Uint8Array([9, 1, 2, 3, 9]);
    mixer.register("cue", original.subarray(1, 4));
    original.fill(8);
    mixer.register("cue", new Uint8Array([1, 2, 3]));
    expect(() => mixer.register("cue", original)).toThrow("different bytes");
    let attempt = 0;
    context.decode = async bytes => {
      expect([...new Uint8Array(bytes)]).toEqual([1, 2, 3]);
      structuredClone(bytes, { transfer: [bytes] });
      if (attempt++ === 0) throw new Error("decoder rejected data");
      return { duration: 1 } as AudioBuffer;
    };
    await mixer.unlock();
    expect(mixer.inspection()).toMatchObject({ decoded: 0, decodeErrors: { cue: "decoder rejected data" } });
    expect(mixer.play("cue", "actor")).toBeNull();
    await mixer.unlock();
    expect(mixer.inspection()).toMatchObject({ decoded: 1, decodeErrors: {}, error: null });
    expect(context.decodedArguments).toHaveLength(2);
    expect(mixer.play("cue", "actor")).not.toBeNull();
    await mixer.unlock();
    expect(context.decodedArguments).toHaveLength(2);
    mixer.dispose();
  });

  it("shares an in-flight decode and never caches a completion after disposal", async () => {
    const { mixer, context } = fixture();
    const decode = deferred<AudioBuffer>();
    context.decode = () => decode.promise;
    mixer.register("cue", new Uint8Array([1]));
    const a = mixer.unlock(), b = mixer.unlock();
    await Promise.resolve();
    expect(context.decodedArguments).toHaveLength(1);
    mixer.dispose(); mixer.dispose();
    decode.resolve({ duration: 1 } as AudioBuffer);
    await Promise.all([a, b]);
    expect(mixer.inspection()).toMatchObject({ state: "disposed", registered: 0, decoded: 0, decoding: 0, active: 0 });
    expect(mixer.play("cue", "actor")).toBeNull();
    expect(context.createdSources).toHaveLength(0);
    expect(context.closes).toBe(1);
    await mixer.unlock();
    expect(context.resumes).toBe(2);
    expect(mixer.captureStream()).toBeNull();
  });

  it("cancels decode scheduling when disposed before the first microtask", async () => {
    const { mixer, context } = fixture();
    mixer.register("cue", new Uint8Array([1]));
    const pending = mixer.unlock();
    mixer.dispose();
    await pending;
    expect(context.decodedArguments).toHaveLength(0);
  });

  it("keeps output and recording behind master mute/volume and measures analyser samples", async () => {
    const { mixer, context } = fixture();
    mixer.setVolume(.4);
    mixer.register("cue", new Uint8Array([1]));
    await mixer.unlock();
    mixer.play("cue", "actor");
    expect(context.createdSources[0]!.connections).toEqual([context.gain]);
    expect(context.gain.connections).toEqual([context.analyser]);
    expect(context.analyser.connections).toEqual([context.destination]);
    const stream = mixer.captureStream();
    expect(stream).toBe(context.capture.stream);
    expect(mixer.captureStream()).toBe(stream);
    expect(context.captureCalls).toBe(1);
    expect(context.analyser.connections).toEqual([context.destination, context.capture]);
    expect(context.gain.connections).toEqual([context.analyser]);
    expect(mixer.inspection().output.rms).toBeCloseTo(Math.sqrt((.25 + .0625) / 2) * .4);
    expect(mixer.inspection().output.peak).toBeCloseTo(.2);
    mixer.setMuted(true);
    mixer.setVolume(.75);
    expect(context.gain.gain.value).toBe(0);
    expect(mixer.inspection().output).toMatchObject({ available: true, rms: 0, peak: 0 });
    expect(mixer.play("cue", "actor")).toBeNull();
    mixer.setMuted(false);
    expect(context.gain.gain.value).toBe(.75);
    mixer.dispose(); mixer.dispose();
    expect(context.capture.trackStops).toBe(1);
    expect(context.gain.connections).toEqual([]);
    expect(context.analyser.connections).toEqual([]);
    expect(mixer.inspection().output).toMatchObject({ available: false, rms: null, peak: null });
  });

  it("supports output/capture without an analyser without claiming measured amplitude", async () => {
    const { mixer, context } = fixture();
    context.createAnalyser = undefined;
    await mixer.unlock();
    expect(context.gain.connections).toEqual([context.destination]);
    expect(mixer.inspection().output).toMatchObject({ available: false, rms: null, peak: null });
    mixer.captureStream();
    expect(context.gain.connections).toEqual([context.destination, context.capture]);
    mixer.setMuted(true);
    expect(context.gain.gain.value).toBe(0);
    mixer.dispose();
  });

  it("stops an owner independently, tolerates ended races, and never replays after pause", async () => {
    const { mixer, context } = fixture();
    mixer.register("cue", new Uint8Array([1]));
    await mixer.unlock();
    mixer.play("cue", "a"); mixer.play("cue", "b"); mixer.play("cue", "a");
    const [a, b, again] = context.createdSources;
    const staleEnded = a!.onended;
    a!.failStop = true;
    mixer.stopOwner("a");
    staleEnded?.();
    expect(mixer.inspection().active).toBe(1);
    expect(a!.stops).toBe(1); expect(a!.disconnects).toBe(1); expect(again!.stops).toBe(1);
    expect(b!.stops).toBe(0);
    mixer.setPaused(true);
    expect(b!.stops).toBe(1);
    expect(mixer.play("cue", "b")).toBeNull();
    mixer.setPaused(false);
    expect(mixer.inspection()).toMatchObject({ active: 0, played: 3 });
    expect(context.createdSources).toHaveLength(3);
    mixer.dispose();
    expect(b!.stops).toBe(1);
  });

  it("releases naturally ended sources and enforces explicit preview voice/offset bounds", async () => {
    const { mixer, context } = fixture({ maxActiveSources: 1, maxCatchupOffsetSeconds: .2 });
    mixer.register("cue", new Uint8Array([1]));
    expect(mixer.play("cue", "a")).toBeNull();
    await mixer.unlock();
    expect(mixer.play("cue", "a", .2)).not.toBeNull();
    expect(mixer.play("cue", "b")).toBeNull();
    expect(mixer.inspection().lastDropReason).toBe("voice-limit");
    const source = context.createdSources[0]!;
    source.end(); source.end();
    expect(source.stops).toBe(0); expect(source.disconnects).toBe(1);
    expect(mixer.play("cue", "b", .2001)).toBeNull();
    expect(mixer.inspection().lastDropReason).toBe("stale-offset");
    expect(mixer.inspection().limits).toEqual({ maxActiveSources: 1, maxCatchupOffsetSeconds: .2, policy: "source-cue-preview" });
    expect(context.createdSources).toHaveLength(1);
    mixer.dispose();
  });

  it("refuses past-buffer offsets, malformed playback and invalid control values", async () => {
    const { mixer, context } = fixture();
    context.decode = async () => ({ duration: .1 }) as AudioBuffer;
    mixer.register("cue", new Uint8Array([1]));
    await mixer.unlock();
    for (const offset of [-1, NaN, Infinity]) expect(mixer.play("cue", "a", offset)).toBeNull();
    expect(mixer.play("", "a")).toBeNull();
    expect(mixer.play("cue", " ")).toBeNull();
    expect(mixer.play("absent", "a")).toBeNull();
    expect(mixer.play("cue", "a", .1)).toBeNull();
    expect(context.createdSources).toHaveLength(0);
    for (const volume of [-1, 1.1, NaN, Infinity]) expect(() => mixer.setVolume(volume)).toThrow();
    expect(() => mixer.setMuted(1 as unknown as boolean)).toThrow();
    expect(() => mixer.setPaused(undefined as unknown as boolean)).toThrow();
    expect(() => mixer.register("", new Uint8Array([1]))).toThrow();
    expect(() => mixer.register("empty", new Uint8Array())).toThrow();
    mixer.dispose();
  });

  it("does not start or leak a failed source, suspended context, or invalid decoded duration", async () => {
    const { mixer, context } = fixture();
    mixer.register("cue", new Uint8Array([1]));
    await mixer.unlock();
    context.failStart = true;
    expect(mixer.play("cue", "a")).toBeNull();
    expect(mixer.inspection()).toMatchObject({ active: 0, played: 0, lastDropReason: "start-failed" });
    expect(context.createdSources[0]!.disconnects).toBe(1);
    context.state = "suspended";
    expect(mixer.play("cue", "a")).toBeNull();
    expect(context.createdSources).toHaveLength(1);
    context.decode = async () => ({ duration: Infinity }) as AudioBuffer;
    mixer.register("invalid", new Uint8Array([2]));
    await mixer.unlock();
    expect(mixer.inspection().decodeErrors.invalid).toContain("finite positive duration");
    mixer.dispose();
  });

  it("recovers from a blocked resume without discarding valid decoded files", async () => {
    const { mixer, context } = fixture();
    context.resumeAction = () => Promise.reject(new Error("gesture required"));
    mixer.register("cue", new Uint8Array([1]));
    await mixer.unlock();
    expect(mixer.inspection().error).toBe("gesture required");
    expect(mixer.play("cue", "a")).toBeNull();
    context.resumeAction = () => { context.state = "running"; return Promise.resolve(); };
    await mixer.unlock();
    expect(mixer.inspection()).toMatchObject({ error: null, decoded: 1, state: "running" });
    expect(context.decodedArguments).toHaveLength(1);
    mixer.dispose();
  });

  it("decodes later registration without another context or automatic playback", async () => {
    const { mixer, context, created } = fixture();
    await mixer.unlock();
    mixer.register("late", new Uint8Array([4, 5]));
    expect(mixer.inspection().decoding).toBe(1);
    expect(mixer.play("late", "a")).toBeNull();
    await mixer.unlock();
    expect(created()).toBe(1);
    expect(context.decodedArguments).toHaveLength(1);
    expect(mixer.inspection()).toMatchObject({ decoded: 1, played: 0 });
    mixer.dispose();
  });

  it("closes a partial graph once and can retry context construction", async () => {
    const broken = new FakeContext(), working = new FakeContext();
    broken.failGain = true;
    let count = 0;
    const mixer = new WorldAudioMixer({ makeContext: () => (count++ ? working : broken) as unknown as AudioContext });
    await mixer.unlock();
    expect(mixer.inspection()).toMatchObject({ state: "error", error: "graph failure" });
    expect(broken.closes).toBe(1);
    await mixer.unlock();
    expect(mixer.inspection().state).toBe("running");
    mixer.dispose(); mixer.dispose();
    expect(broken.closes).toBe(1); expect(working.closes).toBe(1);
  });

  it("rejects invalid preview-limit configuration", () => {
    for (const maxActiveSources of [0, -1, 1.5, 129, Infinity]) {
      expect(() => new WorldAudioMixer({ maxActiveSources })).toThrow();
    }
    for (const maxCatchupOffsetSeconds of [-1, NaN, Infinity, 5.1]) {
      expect(() => new WorldAudioMixer({ maxCatchupOffsetSeconds })).toThrow();
    }
  });
});
