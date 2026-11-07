import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { parseEffectManifest, type EffectBundle, type EffectManifest } from "../../src/effects/nativeEffectComponents";
import { createNativeEffectShotTimeline, NATIVE_EFFECT_SHOT_DEFAULT_SEED } from "../../src/effects/nativeEffectShotTimeline";

const HASH = "82e36ae7305abade2520dba335839c7422d878e6c07caa95323b47f7626f0afd";
const DIRECTORY = resolve("public/l2/effects", HASH);
const raw = await readFile(resolve(DIRECTORY, "manifest.json"));
const retained = parseEffectManifest(JSON.parse(raw.toString("utf8")));
const ACTOR = "lineageeffect.p_u004_a";
function fixture(edit?: (manifest: EffectManifest) => void) {
  const manifest = structuredClone(retained); edit?.(manifest);
  const readResource = vi.fn<EffectBundle["readResource"]>(() => { throw new Error("Pure timeline must not read resources"); });
  return { manifest, manifestSha256: HASH, readResource };
}
function component(manifest: EffectManifest, suffix: string) { return manifest.components.find(row => row.object === `${ACTOR}.${suffix}`)!; }
function props(manifest: EffectManifest, suffix: string) { return component(manifest, suffix).effectiveProperties; }
const pair = (value: number) => ({ Min: value, Max: value });
const ranges = (x: number, y = x, z = x) => ({ X: pair(x), Y: pair(y), Z: pair(z) });
function particle(timeline: ReturnType<typeof createNativeEffectShotTimeline>, time: number, name: string, index = 0) {
  return timeline.evaluate(time).particles.find(row => row.component === `${ACTOR}.${name}` && row.index === index)!;
}
function close(actual: readonly number[], expected: readonly number[], precision = 10) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, precision));
}

describe("source Power Strike modern target-impact timeline", () => {
  it("selects all 11 particles and exactly five original resources without requesting payloads", async () => {
    expect(createHash("sha256").update(raw).digest("hex")).toBe(HASH);
    const bundle = fixture(), timeline = createNativeEffectShotTimeline(bundle);
    expect(timeline.capacity).toBe(11); expect(timeline.duration).toBe(7 / 10000 + .3);
    expect(timeline.seed).toBe(NATIVE_EFFECT_SHOT_DEFAULT_SEED);
    expect(timeline.components.map(row => row.object)).toEqual(["SpriteEmitter9", "MeshEmitter15", "MeshEmitter16"].map(name => `${ACTOR}.${name}`));
    expect(timeline.resources).toHaveLength(5);
    expect(timeline.resources.filter(row => row.kind === "texture")).toHaveLength(3);
    expect(timeline.resources.some(row => row.object === "Engine.S_Emitter")).toBe(false);
    for (const resource of timeline.resources) {
      expect(resource).toEqual(retained.resources[resource.assetId]);
      const payload = await readFile(resolve(DIRECTORY, resource.file));
      expect(payload.length).toBe(resource.bytes); expect(createHash("sha256").update(payload).digest("hex")).toBe(resource.sha256);
    }
    expect(bundle.readResource).not.toHaveBeenCalled();
  });

  it("uses finite exact half-open lifetimes and cumulative counts without replay", () => {
    const timeline = createNativeEffectShotTimeline(fixture());
    expect(timeline.evaluate(0)).toMatchObject({ born: 3, expired: 0, complete: false });
    expect(timeline.evaluate(.001).particles).toHaveLength(11);
    const schedule = [["SpriteEmitter9", 8, 10000, .3], ["MeshEmitter15", 1, 1000, .2], ["MeshEmitter16", 2, 10000, .3]] as const;
    for (const [name, count, rate, life] of schedule) for (let index = 0; index < count; index++) {
      const birth = index / rate, death = birth + life;
      if (birth > 0) expect(particle(timeline, birth - Number.EPSILON, name, index)).toBeUndefined();
      expect(particle(timeline, birth, name, index)).toBeDefined();
      expect(particle(timeline, death - Number.EPSILON, name, index)).toBeDefined();
      expect(particle(timeline, death, name, index)).toBeUndefined();
    }
    expect(timeline.evaluate(timeline.duration)).toMatchObject({ born: 11, expired: 11, particles: [], complete: true });
    expect(timeline.evaluate(99)).toMatchObject({ born: 11, expired: 11, particles: [], complete: true });
  });

  it("preserves inputs, freezes its cloned source and is repeatable across seeks and caller mutation", () => {
    const bundle = fixture(), original = JSON.stringify(bundle.manifest);
    const a = createNativeEffectShotTimeline(bundle, 123), b = createNativeEffectShotTimeline(fixture(), 123), sample = a.evaluate(.12);
    a.evaluate(.3); a.evaluate(0); expect(a.evaluate(.12)).toEqual(sample); expect(b.evaluate(.12)).toEqual(sample);
    expect(createNativeEffectShotTimeline(fixture(), 124).evaluate(.12)).not.toEqual(sample);
    expect(JSON.stringify(bundle.manifest)).toBe(original);
    (sample.particles[0]!.billboardDirection as unknown as number[])[0] = 99;
    (sample.particles[0]!.position as unknown as number[])[0] = 99;
    expect(a.evaluate(.12)).toEqual(b.evaluate(.12));
    props(bundle.manifest, "SpriteEmitter9").StartLocationOffset = { X: 900, Y: 0, Z: 0 };
    expect(a.evaluate(.12)).toEqual(b.evaluate(.12));
    expect(() => { a.components[0]!.effectiveProperties.MaxParticles = 999; }).toThrow();
    expect(bundle.readResource).not.toHaveBeenCalled();
  });

  it("constructs the selected +X polar-axis YZ ring and adds the source offset before radial velocity", () => {
    const timeline = createNativeEffectShotTimeline(fixture(manifest => {
      const p = props(manifest, "SpriteEmitter9"); p.StartLocationPolarRange = ranges(90, 0, 10); p.StartVelocityRange = ranges(130, 140, 150);
    }));
    const born = particle(timeline, 0, "SpriteEmitter9");
    close(born.position, [.02, 0, .1]);
    const norm = Math.sqrt(104), sourceVelocity = [130 * 2 / norm, 140 * 10 / norm, 0];
    const velocityNorm = Math.hypot(...sourceVelocity);
    close(born.billboardDirection!, [sourceVelocity[0]! / velocityNorm, 0, sourceVelocity[1]! / velocityNorm]);
    const age = .1, distance = -Math.expm1(-.5 * age) / .5;
    close(particle(timeline, age, "SpriteEmitter9").position, [(2 + sourceVelocity[0]! * distance) * .01, 0, (10 + sourceVelocity[1]! * distance) * .01]);
    expect(born.billboardAngle).toBeUndefined(); expect(born.quaternion).toEqual([0, 0, 0, 1]);
  });

  it("makes the documented polar alternatives distinguishable and uses ProjectionNormal as the modern axis", () => {
    const sample = (normal: [number, number, number], theta: number, phi: number) => createNativeEffectShotTimeline(fixture(manifest => {
      const p = props(manifest, "SpriteEmitter9"); p.ProjectionNormal = { X: normal[0], Y: normal[1], Z: normal[2] };
      p.StartLocationPolarRange = ranges(theta, phi, 12.5);
    }));
    close(particle(sample([1, 0, 0], 90, 0), 0, "SpriteEmitter9").position, [.02, 0, .125]);
    close(particle(sample([1, 0, 0], 90, 90), 0, "SpriteEmitter9").position, [.02, .125, 0]);
    close(particle(sample([0, 0, 1], 90, 0), 0, "SpriteEmitter9").position, [.145, 0, 0]);
    close(particle(sample([1, 0, 0], 0, 90), 0, "SpriteEmitter9").position, [.145, 0, 0]);
  });

  it("keeps source radius and all needle starts on the selected transverse plane", () => {
    const timeline = createNativeEffectShotTimeline(fixture());
    for (let index = 0; index < 8; index++) {
      const state = particle(timeline, index / 10000, "SpriteEmitter9", index);
      expect(state.position[0]).toBeCloseTo(.02, 12);
      const radius = Math.hypot(state.position[1], state.position[2]);
      expect(radius).toBeGreaterThanOrEqual(.1); expect(radius).toBeLessThan(.15);
      expect(Math.hypot(...state.billboardDirection!)).toBeCloseTo(1, 12);
    }
  });

  it("returns direction of the current exponentially decayed velocity, not a stale initial vector", () => {
    const timeline = createNativeEffectShotTimeline(fixture(manifest => {
      const p = props(manifest, "SpriteEmitter9"); p.StartLocationPolarRange = ranges(90, 45, 10);
      p.StartVelocityRange = ranges(140); p.VelocityLossRange = ranges(0, 1, 2);
    }));
    const initial = particle(timeline, 0, "SpriteEmitter9").billboardDirection!, time = .1;
    const decayed = [initial[0], initial[1] * Math.exp(-2 * time), initial[2] * Math.exp(-time)];
    const magnitude = Math.hypot(...decayed);
    close(particle(timeline, time, "SpriteEmitter9").billboardDirection!, decayed.map(v => v / magnitude));
  });

  it("uses exact mesh translation and maps native XYZ to XZY metres once without actor DrawScale", () => {
    const timeline = createNativeEffectShotTimeline(fixture());
    close(particle(timeline, .1, "MeshEmitter15").position, [.004, 0, 0]);
    close(particle(timeline, .1, "MeshEmitter16").position, [-.02, 0, 0]);
    expect(particle(timeline, .1, "MeshEmitter16").billboardDirection).toBeUndefined();
    expect(timeline.limitations.join(" ")).toMatch(/DrawScale is retained but not applied/);
  });

  it("clamps missing time-zero size keys and leaves disabled SparkCone scaling and color tracks inactive", () => {
    const timeline = createNativeEffectShotTimeline(fixture(manifest => { props(manifest, "SpriteEmitter9").StartSizeRange = ranges(1); }));
    close(particle(timeline, 0, "SpriteEmitter9").scale, [1.5, 1.5, 1]);
    close(particle(timeline, .73 * .3, "SpriteEmitter9").scale, [1.25, 1.25, 1]);
    close(particle(timeline, 0, "MeshEmitter15").scale, [1.4, 1.4, 1.4]);
    close(particle(timeline, .16 * .2, "MeshEmitter15").scale, [1.55, 1.55, 1.55]);
    close(particle(timeline, .1, "MeshEmitter16").scale, [1, 1, 1]);
    expect(timeline.evaluate(.1).particles.every(row => row.rgba.every(value => value === 1))).toBe(true);
  });

  it("computes fade independently from source opacity and multiplier, avoiding duplicate multiplication", () => {
    const timeline = createNativeEffectShotTimeline(fixture());
    for (const [name, start, life] of [["SpriteEmitter9", .084, .3], ["MeshEmitter15", .0375, .2], ["MeshEmitter16", .039, .3]] as const) {
      expect(particle(timeline, 0, name).fade).toBe(1);
      expect(particle(timeline, start, name).fade).toBe(1);
      expect(particle(timeline, (start + life) / 2, name).fade).toBeCloseTo(.5, 12);
    }
  });

  it("selects tile 2 then tile 3 in each particle's equal age halves, with no extra atlas frame", () => {
    const timeline = createNativeEffectShotTimeline(fixture());
    for (let index = 0; index < 8; index++) {
      const birth = index / 10000;
      expect(particle(timeline, birth + .149, "SpriteEmitter9", index).frame).toBe(0);
      expect(particle(timeline, birth + .151, "SpriteEmitter9", index).frame).toBe(1);
      expect(particle(timeline, birth + .299, "SpriteEmitter9", index).frame).toBe(1);
    }
    expect(particle(timeline, .15, "SpriteEmitter9").frame).toBe(1);
    expect(particle(timeline, .15, "SpriteEmitter9", 7).frame).toBe(0);
    expect(particle(timeline, .1, "MeshEmitter15").frame).toBe(0);
  });

  it("uses reflected native mesh Z-turns and the declared sign policy for spin speed", () => {
    const make = (sign: number) => createNativeEffectShotTimeline(fixture(manifest => {
      const p = props(manifest, "MeshEmitter16"); p.StartSpinRange = ranges(0, 0, .25); p.SpinsPerSecondRange = ranges(0, 0, .2);
      p.SpinCCWorCW = { X: sign, Y: sign, Z: sign };
    }));
    for (const sign of [0, 1]) {
      const state = particle(make(sign), .1, "MeshEmitter16"), matrix = Matrix.Identity();
      Quaternion.FromArray(state.quaternion!).toRotationMatrix(matrix);
      const angle = (.25 + (sign === 0 ? 1 : -1) * .02) * 2 * Math.PI;
      close(Vector3.TransformCoordinates(new Vector3(1, 0, 0), matrix).asArray(), [Math.cos(angle), 0, Math.sin(angle)], 6);
    }
  });

  it.each([NaN, Infinity, -Infinity, -1])("rejects invalid time %s", time => {
    expect(() => createNativeEffectShotTimeline(fixture()).evaluate(time)).toThrow(/source seconds/);
  });
  it.each([NaN, Infinity, -1, 1.25, 4294967296])("rejects invalid seed %s", seed => {
    expect(() => createNativeEffectShotTimeline(fixture(), seed)).toThrow(/seed/);
  });
  it.each([
    ["zero polar axis", (p: Record<string, unknown>) => { p.ProjectionNormal = { X: 0, Y: 0, Z: 0 }; }],
    ["negative radius", (p: Record<string, unknown>) => { p.StartLocationPolarRange = ranges(90, 90, -1); }],
    ["unsupported angle", (p: Record<string, unknown>) => { p.StartLocationPolarRange = ranges(190, 90, 10); }],
    ["nonfinite speed", (p: Record<string, unknown>) => { p.StartVelocityRange = ranges(Infinity); }],
    ["unsupported direction", (p: Record<string, unknown>) => { p.GetVelocityDirectionFrom = 1; }],
    ["invented spin", (p: Record<string, unknown>) => { p.SpinParticles = true; }],
    ["invented color enabling", (p: Record<string, unknown>) => { p.UseColorScale = true; }],
    ["atlas policy drift", (p: Record<string, unknown>) => { p.UseRandomSubdivision = true; }],
    ["duplicate size time", (p: Record<string, unknown>) => { p.SizeScale = [{ RelativeTime: .5, RelativeSize: 1 }, { RelativeTime: .5, RelativeSize: 2 }]; }],
    ["bad fade", (p: Record<string, unknown>) => { p.FadeOutStartTime = .4; }],
    ["cross-emitter coupling", (p: Record<string, unknown>) => { p.AddVelocityFromOtherEmitter = 0; }],
    ["continuous emission", (p: Record<string, unknown>) => { p.ParticlesPerSecond = 8; }],
    ["source count drift", (p: Record<string, unknown>) => { p.MaxParticles = 9; }],
  ] as const)("rejects %s rather than silently applying a different path", (_label, edit) => {
    expect(() => createNativeEffectShotTimeline(fixture(manifest => edit(props(manifest, "SpriteEmitter9"))))).toThrow();
  });

  it("rejects dispatch, component and frame identity drift", () => {
    expect(() => createNativeEffectShotTimeline(fixture(manifest => { manifest.actors.find(row => row.object === ACTOR)!.dispatchStages = ["init"]; }))).toThrow(/shot actor/);
    expect(() => createNativeEffectShotTimeline(fixture(manifest => { component(manifest, "MeshEmitter15").emitterOrdinal = 8; }))).toThrow(/identity/);
    expect(() => createNativeEffectShotTimeline(fixture(manifest => { props(manifest, "SpriteEmitter9").SubdivisionStart = 0; }))).toThrow(/atlas/);
    expect(() => createNativeEffectShotTimeline(fixture(manifest => { manifest.textureGraph = manifest.textureGraph.filter(row => !row.object.endsWith("fx_m_t0006")); }))).toThrow(/graph entry/);
  });
});
