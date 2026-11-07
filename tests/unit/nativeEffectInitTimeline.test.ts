import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { parseEffectManifest, type EffectBundle, type EffectManifest } from "../../src/effects/nativeEffectComponents";
import { createNativeEffectInitTimeline, NATIVE_EFFECT_INIT_DEFAULT_SEED } from "../../src/effects/nativeEffectInitTimeline";

const HASH = "82e36ae7305abade2520dba335839c7422d878e6c07caa95323b47f7626f0afd";
const DIRECTORY = resolve("public/l2/effects", HASH);
const raw = await readFile(resolve(DIRECTORY, "manifest.json"));
const retained = parseEffectManifest(JSON.parse(raw.toString("utf8")));
const ACTOR = "lineageeffect.s_u002_a";
function fixture(edit?: (manifest: EffectManifest) => void) {
  const manifest = structuredClone(retained); edit?.(manifest);
  const readResource = vi.fn<EffectBundle["readResource"]>(() => { throw new Error("Pure timeline must not read resources"); });
  return { manifest, manifestSha256: HASH, readResource };
}
function component(manifest: EffectManifest, suffix: string) { return manifest.components.find(row => row.object === `${ACTOR}.${suffix}`)!; }
function props(manifest: EffectManifest, suffix: string) { return component(manifest, suffix).effectiveProperties; }
const pair = (value: number) => ({ Min: value, Max: value });
const ranges = (x: number, y = x, z = x) => ({ X: pair(x), Y: pair(y), Z: pair(z) });
function particle(timeline: ReturnType<typeof createNativeEffectInitTimeline>, time: number, name: string, index = 0) {
  return timeline.evaluate(time).particles.find(row => row.component === `${ACTOR}.${name}` && row.index === index)!;
}
function close(actual: readonly number[], expected: readonly number[], precision = 10) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, precision));
}

describe("finite source Power Strike init timeline", () => {
  it("selects the exact init actor, all three components and eight canonical original resources", async () => {
    expect(createHash("sha256").update(raw).digest("hex")).toBe(HASH);
    const bundle = fixture(), timeline = createNativeEffectInitTimeline(bundle);
    expect(timeline.capacity).toBe(19); expect(timeline.duration).toBe(10 / 9 + .45);
    expect(timeline.seed).toBe(NATIVE_EFFECT_INIT_DEFAULT_SEED);
    expect(timeline.components.map(row => row.object)).toEqual(["MeshEmitter2", "SpriteEmitter2", "MeshEmitter5"].map(name => `${ACTOR}.${name}`));
    expect(timeline.resources).toHaveLength(8);
    expect(timeline.resources.filter(row => row.file.endsWith(".glb"))).toHaveLength(2);
    expect(timeline.resources.filter(row => row.file.endsWith(".png"))).toHaveLength(6);
    expect(timeline.resources.some(row => row.object === "Engine.S_Emitter")).toBe(false);
    for (const resource of timeline.resources) {
      expect(resource).toEqual(retained.resources[resource.assetId]);
      const bytes = await readFile(resolve(DIRECTORY, resource.file));
      expect(bytes.length).toBe(resource.bytes); expect(createHash("sha256").update(bytes).digest("hex")).toBe(resource.sha256);
    }
    expect(bundle.readResource).not.toHaveBeenCalled();
  });

  it("uses exact half-open particle lifetimes with finite cumulative births and expirations", () => {
    const timeline = createNativeEffectInitTimeline(fixture());
    expect(timeline.evaluate(0)).toMatchObject({ born: 2, expired: 0, complete: false });
    expect(timeline.evaluate(0).particles.every(row => row.fade === 0)).toBe(true);
    const schedules = [["MeshEmitter2", 11, 9, 0, .45], ["SpriteEmitter2", 1, 1000, 0, 1.5], ["MeshEmitter5", 7, 10, .5, .4]] as const;
    for (const [name, count, rate, delay, life] of schedules) for (let index = 0; index < count; index++) {
      const birth = delay + index / rate, death = birth + life;
      if (birth > 0) expect(particle(timeline, birth - Number.EPSILON, name, index)).toBeUndefined();
      expect(particle(timeline, birth, name, index)).toBeDefined();
      expect(particle(timeline, death - Number.EPSILON, name, index)).toBeDefined();
      expect(particle(timeline, death, name, index)).toBeUndefined();
    }
    expect(timeline.evaluate(.5)).toMatchObject({ born: 7, expired: 1, complete: false });
    expect(timeline.evaluate(.5).particles).toHaveLength(6);
    expect(timeline.evaluate(timeline.duration)).toMatchObject({ born: 19, expired: 19, particles: [], complete: true });
    expect(timeline.evaluate(100)).toMatchObject({ born: 19, expired: 19, particles: [], complete: true });
  });

  it("is seekable, seed-repeatable and independent of frame order or mutated caller results", () => {
    const bundle = fixture(), before = JSON.stringify(bundle.manifest), a = createNativeEffectInitTimeline(bundle, 123), b = createNativeEffectInitTimeline(fixture(), 123);
    const sample = a.evaluate(.77); a.evaluate(1.5); a.evaluate(0); expect(a.evaluate(.77)).toEqual(sample); expect(b.evaluate(.77)).toEqual(sample);
    expect(createNativeEffectInitTimeline(fixture(), 124).evaluate(.77)).not.toEqual(sample);
    (sample.particles[0]!.position as unknown as number[])[0] = 999;
    expect(a.evaluate(.77)).toEqual(b.evaluate(.77));
    props(bundle.manifest, "MeshEmitter2").StartSizeRange = ranges(20);
    expect(a.evaluate(.77)).toEqual(b.evaluate(.77));
    expect(before).not.toEqual(JSON.stringify(bundle.manifest));
    expect(() => { a.components[0]!.effectiveProperties.MaxParticles = 999; }).toThrow();
    expect(bundle.readResource).not.toHaveBeenCalled();
  });

  it("leaves the retained manifest and actor DrawScale/AutoReplay/Location untouched", () => {
    const bundle = fixture(), before = JSON.stringify(bundle.manifest);
    const timeline = createNativeEffectInitTimeline(bundle); timeline.evaluate(.3); timeline.evaluate(4);
    expect(JSON.stringify(bundle.manifest)).toBe(before);
    expect(timeline.limitations.join(" ")).toMatch(/DrawScale is not applied/);
    expect(particle(timeline, .1, "SpriteEmitter2").position).toEqual([0, 0, 0]);
    expect(timeline.evaluate(4).particles).toEqual([]);
  });

  it("samples independent size axes unless UniformSize is explicitly true, then uses one range fraction", () => {
    const edit = (manifest: EffectManifest) => {
      const p = props(manifest, "MeshEmitter2"); p.StartSizeRange = { X: { Min: 1, Max: 3 }, Y: { Min: 2, Max: 6 }, Z: { Min: 4, Max: 12 } }; p.UseSizeScale = false;
    };
    const independent = createNativeEffectInitTimeline(fixture(edit));
    const shared = createNativeEffectInitTimeline(fixture(manifest => { edit(manifest); props(manifest, "MeshEmitter2").UniformSize = true; }));
    const a = particle(independent, .1, "MeshEmitter2").scale, b = particle(shared, .1, "MeshEmitter2").scale;
    expect(new Set(a).size).toBe(3); expect(new Set(b).size).toBe(1);
    expect(a.every(value => value >= .5 && value < 1.5)).toBe(true);
    // Inherited UniformMeshScale=true did not collapse independent start-size axes.
    expect(independent.components[0]!.effectiveProperties.UniformMeshScale).toBe(true);
  });

  it("maps mesh relative XYZ size to XZY and leaves sprite plane Z unchanged", () => {
    const timeline = createNativeEffectInitTimeline(fixture(manifest => {
      const p = props(manifest, "MeshEmitter2"); p.StartSizeRange = ranges(1, 2, 3); p.UseSizeScale = false;
    }));
    close(particle(timeline, .1, "MeshEmitter2").scale, [1, 1, 1]);
    close(particle(timeline, 0, "SpriteEmitter2").scale, [1.4, 1.4, 1]);
    close(particle(timeline, .65 * 1.5, "SpriteEmitter2").scale, [1.7, 1.7, 1]);
    close(particle(timeline, .99 * 1.5, "SpriteEmitter2").scale, [1.9, 1.9, 1]);
    close(particle(timeline, .55, "MeshEmitter5").scale, [1, 1, 1]);
  });

  it("linearly evaluates source size keys and clamps absent time-zero keys without inventing a key", () => {
    const timeline = createNativeEffectInitTimeline(fixture(manifest => { props(manifest, "MeshEmitter2").StartSizeRange = ranges(.165); }));
    close(particle(timeline, .35 * .45, "MeshEmitter2").scale, [.75, .75, .75]);
    close(particle(timeline, .7 * .45, "MeshEmitter2").scale, [.5, .5, .5]);
    close(particle(timeline, .85 * .45, "MeshEmitter2").scale, [.255, .255, .255]);
    close(particle(timeline, .1, "SpriteEmitter2").scale, [1.4, 1.4, 1]);
  });

  it("uses 15/20 total color cycles, returns first key at integer phase, and ignores disabled MeshEmitter5 keys", () => {
    const timeline = createNativeEffectInitTimeline(fixture());
    const age = .357143 / 15 * .45;
    close(particle(timeline, age, "MeshEmitter2").rgba, [1, 1, 1, 191 / 255]);
    close(particle(timeline, .45 / 15, "MeshEmitter2").rgba, [1, 1, 1, 1]);
    close(particle(timeline, .857143 / 20 * 1.5, "SpriteEmitter2").rgba, [93 / 255, 93 / 255, 93 / 255, 1]);
    close(particle(timeline, 1.5 / 20, "SpriteEmitter2").rgba, [1, 1, 1, 1]);
    close(particle(timeline, .7, "MeshEmitter5").rgba, [1, 1, 1, 1]);
  });

  it("computes declared linear fades without multiplying original source opacity twice", () => {
    const timeline = createNativeEffectInitTimeline(fixture());
    expect(particle(timeline, .1845 / 2, "MeshEmitter2").fade).toBeCloseTo(.5, 12);
    expect(particle(timeline, .2, "MeshEmitter2").fade).toBe(1);
    expect(particle(timeline, (.252 + .45) / 2, "MeshEmitter2").fade).toBeCloseTo(.5, 12);
    expect(particle(timeline, .435 / 2, "SpriteEmitter2").fade).toBeCloseTo(.5, 12);
    expect(particle(timeline, 1.35, "SpriteEmitter2").fade).toBeCloseTo(.5, 12);
    expect(particle(timeline, .5 + .039 / 2, "MeshEmitter5").fade).toBeCloseTo(.5, 12);
    expect(particle(timeline, .5 + (.069 + .4) / 2, "MeshEmitter5").fade).toBeCloseTo(.5, 12);
  });

  it("computes stable exponential drag displacement analytically and converts XYZ to XZY metres once", () => {
    const timeline = createNativeEffectInitTimeline(fixture(manifest => {
      const p = props(manifest, "MeshEmitter5"); p.StartVelocityRange = ranges(10, -20, 30); p.VelocityLossRange = ranges(2, 0, 1e-10);
      p.StartLocationOffset = { X: 100, Y: 200, Z: 300 };
    }));
    const age = .2;
    const source = [100 + 10 * (1 - Math.exp(-2 * age)) / 2, 200 - 20 * age, 300 + 30 * -Math.expm1(-1e-10 * age) / 1e-10];
    close(particle(timeline, .5 + age, "MeshEmitter5").position, [source[0]! * .01, source[2]! * .01, source[1]! * .01]);
  });

  it("rotates mesh source X then Y then Z and conjugates the XZY reflection", () => {
    const turns = [.13, .21, .31];
    const timeline = createNativeEffectInitTimeline(fixture(manifest => {
      const p = props(manifest, "MeshEmitter2"); p.StartSpinRange = ranges(turns[0]!, turns[1]!, turns[2]!);
    }));
    const state = particle(timeline, .1, "MeshEmitter2");
    expect(state.quaternion).toBeDefined(); expect(Math.hypot(...state.quaternion!)).toBeCloseTo(1, 12);
    const matrix = Matrix.Identity(); Quaternion.FromArray(state.quaternion!).toRotationMatrix(matrix);
    const original = [2, -3, 4] as const;
    let [x, y, z]: number[] = [...original];
    const [ax, ay, az] = turns.map(value => value * 2 * Math.PI);
    [y, z] = [y! * Math.cos(ax!) - z! * Math.sin(ax!), y! * Math.sin(ax!) + z! * Math.cos(ax!)];
    [x, z] = [x! * Math.cos(ay!) + z * Math.sin(ay!), -x! * Math.sin(ay!) + z * Math.cos(ay!)];
    [x, y] = [x * Math.cos(az!) - y * Math.sin(az!), x * Math.sin(az!) + y * Math.cos(az!)];
    close(Vector3.TransformCoordinates(new Vector3(original[0], original[2], original[1]), matrix).asArray(), [x, z, y], 6);
  });

  it("uses deterministic signs only for angular speed and sprite X spin as a separate in-plane angle", () => {
    const positive = createNativeEffectInitTimeline(fixture(manifest => {
      const p = props(manifest, "MeshEmitter5"); p.StartSpinRange = ranges(0); p.SpinCCWorCW = { X: 0, Y: 0, Z: 0 };
    }));
    const negative = createNativeEffectInitTimeline(fixture(manifest => {
      const p = props(manifest, "MeshEmitter5"); p.StartSpinRange = ranges(0); p.SpinCCWorCW = { X: 1, Y: 1, Z: 1 };
    }));
    expect(particle(positive, .7, "MeshEmitter5").quaternion).not.toEqual(particle(negative, .7, "MeshEmitter5").quaternion);
    const sprite = createNativeEffectInitTimeline(fixture(manifest => { props(manifest, "SpriteEmitter2").StartSpinRange = ranges(.25, 0, 0); }));
    const state = particle(sprite, .2, "SpriteEmitter2") as ReturnType<typeof particle> & { billboardAngle: number };
    expect(state.quaternion).toEqual([0, 0, 0, 1]); expect(state.billboardAngle).toBeCloseTo(Math.PI / 2, 12);
  });

  it("advances the original charge frames at 18fps from particle age and holds the final frame", () => {
    const timeline = createNativeEffectInitTimeline(fixture());
    expect(particle(timeline, .5, "MeshEmitter5").frame).toBe(0);
    expect(particle(timeline, .5 + .06, "MeshEmitter5").frame).toBe(1);
    expect(particle(timeline, .5 + .12, "MeshEmitter5").frame).toBe(2);
    expect(particle(timeline, .5 + .18, "MeshEmitter5").frame).toBe(3);
    expect(particle(timeline, .5 + .39, "MeshEmitter5").frame).toBe(3);
    expect(particle(timeline, .8, "MeshEmitter5", 3).frame).toBe(0);
    expect(particle(timeline, .3, "MeshEmitter2").frame).toBe(0);
  });

  it.each([NaN, Infinity, -Infinity, -1])("rejects invalid source time %s", time => {
    expect(() => createNativeEffectInitTimeline(fixture()).evaluate(time)).toThrow(/source seconds/);
  });
  it.each([NaN, Infinity, -1, 1.25, 4294967296])("rejects invalid seed %s", seed => {
    expect(() => createNativeEffectInitTimeline(fixture(), seed)).toThrow(/seed/);
  });
  it.each([
    ["variable lifetime", (p: Record<string, unknown>) => { p.LifetimeRange = { Min: .3, Max: .45 }; }],
    ["invalid range order", (p: Record<string, unknown>) => { p.StartSizeRange = { X: { Min: 2, Max: 1 }, Y: pair(1), Z: pair(1) }; }],
    ["nonfinite range", (p: Record<string, unknown>) => { p.StartVelocityRange = ranges(Infinity); }],
    ["underflowing size range", (p: Record<string, unknown>) => { p.StartSizeRange = ranges(Number.MIN_VALUE); }],
    ["duplicate key times", (p: Record<string, unknown>) => { p.SizeScale = [{ RelativeTime: 0, RelativeSize: 1 }, { RelativeTime: 0, RelativeSize: 2 }]; }],
    ["unordered key times", (p: Record<string, unknown>) => { p.SizeScale = [{ RelativeTime: .5, RelativeSize: 1 }, { RelativeTime: .1, RelativeSize: 2 }]; }],
    ["unsupported coordinate mode", (p: Record<string, unknown>) => { p.CoordinateSystem = 2; }],
    ["active collision", (p: Record<string, unknown>) => { p.UseCollision = true; }],
    ["continuous emission", (p: Record<string, unknown>) => { p.ParticlesPerSecond = 5; }],
    ["cross-emitter dependency", (p: Record<string, unknown>) => { p.AddLocationFromOtherEmitter = 0; }],
    ["nonidentity fade factor", (p: Record<string, unknown>) => { p.FadeInFactor = { W: .5, X: 1, Y: 1, Z: 1 }; }],
    ["bad fade time", (p: Record<string, unknown>) => { p.FadeOutStartTime = 4; }],
  ] as const)("rejects %s rather than silently applying another runtime path", (_label, edit) => {
    expect(() => createNativeEffectInitTimeline(fixture(manifest => edit(props(manifest, "MeshEmitter2"))))).toThrow();
  });
  it("rejects schema, stage/component, texture and frame identity drift", () => {
    expect(() => createNativeEffectInitTimeline(fixture(manifest => { manifest.schemaVersion = 2; }))).toThrow(/manifest/);
    expect(() => createNativeEffectInitTimeline(fixture(manifest => { component(manifest, "MeshEmitter2").emitterOrdinal = 8; }))).toThrow(/identity/);
    expect(() => createNativeEffectInitTimeline(fixture(manifest => { manifest.actors.find(row => row.object === ACTOR)!.dispatchStages = ["shot"]; }))).toThrow(/init actor/);
    expect(() => createNativeEffectInitTimeline(fixture(manifest => { manifest.textureGraph.find(row => row.object.endsWith("fx_m_t0042"))!.animationProperties.MaxFrameRate = 19; }))).toThrow(/frame declaration/);
    expect(() => createNativeEffectInitTimeline(fixture(manifest => { manifest.textureGraph.find(row => row.object.endsWith("fx_m_t0045"))!.animationProperties.AnimNext = { object: "LineageEffectsTextures.Spark.fx_m_t0042" }; }))).toThrow(/cyclic/);
    expect(() => createNativeEffectInitTimeline(fixture(manifest => { manifest.textureGraph = manifest.textureGraph.filter(row => !row.object.endsWith("fx_m_t0050")); }))).toThrow(/graph entry/);
  });
});
