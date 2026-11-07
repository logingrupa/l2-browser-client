import { effectFrames, effectObject, parseEffectManifest, type EffectBundle, type EffectComponent, type EffectResource } from "./nativeEffectComponents";
import type { NativeEffectParticleState } from "./nativeEffectParticlePool";

type Vec3 = [number, number, number];
type Vec4 = [number, number, number, number];
type Range = readonly [number, number];
type Ranges = readonly [Range, Range, Range];
type Key = { time: number; value: number[] };
const AXES = ["X", "Y", "Z"] as const;
const ACTOR = "lineageeffect.s_u002_a";
const EXPECTED = [
  { name: "MeshEmitter2", type: "Engine.MeshEmitter", count: 11, rate: 9, life: .45, delay: 0,
    mesh: "LineageEffectsStaticmeshes.Skill_Power.skill_power01", texture: "LineageEffectsTextures.Particles.fx_m_t0050" },
  { name: "SpriteEmitter2", type: "Engine.SpriteEmitter", count: 1, rate: 1000, life: 1.5, delay: 0,
    mesh: null, texture: "LineageEffectsTextures.Particles.fx_m_t0002" },
  { name: "MeshEmitter5", type: "Engine.MeshEmitter", count: 7, rate: 10, life: .4, delay: .5,
    mesh: "LineageEffectsStaticmeshes.Skill_Power.skill_charge01", texture: "LineageEffectsTextures.Spark.fx_m_t0042" },
] as const;
export const NATIVE_EFFECT_INIT_DEFAULT_SEED = 0x5033534b;
export const NATIVE_EFFECT_INIT_POLICY = "modern-source-init-v1" as const;
const LIMITATIONS = [
  "Finite modern init preview: birth=delay+i/rate, MaxParticles total births, authored lifetimes, no respawn or actor AutoReplay. Native emission scheduling and AdjustparticleLife(ShotTime+1) are not reproduced.",
  "Explicit Special attack generation supplies the source clock. Resource readiness, interruption and pause belong to the manager; this evaluator neither dispatches skills nor advances time.",
  "Uniform seeded ranges use keyed FNV-1a32 plus an integer avalanche; samples are stable per component/index/channel, independent of evaluation order. This is not native RNG.",
  "Only explicit UniformSize=true shares a size sample across XYZ. Mesh scale is sampled/midpoint in XZY; sprite plane scale is source X/Y with Z=1. Actor DrawScale is not applied.",
  "ColorScaleRepeats means total cycles (15/20), with integer phase returning the first key. Enabled color/size keys interpolate linearly with clamped endpoints. Missing UseColorScale disables color; missing size keys mean identity.",
  "Fade is the product of linear per-particle-age ramps in declared seconds; all source fade factors must be one. The pool applies original Opacity exactly once.",
  "Absent location, delay, initial age, velocity and spin rate use explicit zero policies. VelocityLossRange is exponential drag per second; no native integrator is claimed.",
  "StartSpin is turns; SpinsPerSecond is turns/second. A keyed sample below SpinCCWorCW selects negative speed. Mesh rotations apply native X then Y then Z and conjugate by the XZY reflection; sprite X spin is billboard in-plane roll. Native units/order/sign law are unproved.",
  "PTCS_Relative is attached by the manager to the qualified hand anchor. Native attachment composition, actor default Location and generation-time actor adjustments are not applied.",
  "Charge texture follows four source frames at declared 18 fps from particle age and holds the final frame; no loop or native texture clock is inferred.",
  "Existing screen/additive materials remain modern source-component policies. No shot/impact stage, guessed audio, native visible composition, performance or full-client parity is certified.",
] as const;

export interface NativeEffectInitDiagnostic {
  readonly component: string; readonly index: number; readonly birth: number; readonly lifetime: number; readonly age: number;
}
export interface NativeEffectInitEvaluation {
  readonly seconds: number; readonly particles: readonly NativeEffectParticleState[];
  readonly diagnostics: readonly NativeEffectInitDiagnostic[];
  /** Cumulative counts at this sample, not events since the previous call. */
  readonly born: number; readonly expired: number; readonly complete: boolean;
}
export interface NativeEffectInitTimeline {
  readonly policy: typeof NATIVE_EFFECT_INIT_POLICY; readonly seed: number;
  readonly components: readonly EffectComponent[]; readonly resources: readonly EffectResource[];
  readonly capacity: 19; readonly duration: number; readonly limitations: readonly string[];
  evaluate(seconds: number): NativeEffectInitEvaluation;
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Native effect init timeline: ${message}`);
}
function number(value: unknown, label: string): number {
  requireValue(typeof value === "number" && Number.isFinite(value) && Number.isFinite(Math.fround(value)) && (value === 0 || Math.fround(value) !== 0), `${label} must be finite within binary32 magnitude.`);
  return value;
}
function flag(p: Record<string, unknown>, name: string): boolean {
  requireValue(p[name] === undefined || typeof p[name] === "boolean", `${name} must be boolean or absent.`);
  return p[name] === true;
}
function range(value: unknown, label: string, minimum = -1e6): Range {
  requireValue(effectObject(value), `${label} range is missing.`);
  const min = number(value.Min, `${label}.Min`), max = number(value.Max, `${label}.Max`);
  requireValue(min >= minimum && min <= max && max <= 1e6, `${label} range is invalid or unsupported.`);
  return [min, max];
}
function rangeVector(value: unknown, label: string, minimum = -1e6, fallback?: number): Ranges {
  if (value === undefined && fallback !== undefined) return [[fallback, fallback], [fallback, fallback], [fallback, fallback]];
  requireValue(effectObject(value), `${label} vector is missing.`);
  return AXES.map(axis => range(value[axis], `${label}.${axis}`, minimum)) as unknown as Ranges;
}
function vector(value: unknown, label: string, fallback?: number): Vec3 {
  if (value === undefined && fallback !== undefined) return [fallback, fallback, fallback];
  requireValue(effectObject(value), `${label} vector is missing.`);
  return AXES.map(axis => number(value[axis], `${label}.${axis}`)) as Vec3;
}
function constant(value: unknown, label: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  const pair = range(value, label, 0);
  requireValue(pair[0] === pair[1], `${label} must be a constant range.`);
  return pair[0];
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function keys(value: unknown, label: string, color: boolean): Key[] {
  if (value === undefined) return [];
  requireValue(Array.isArray(value) && value.length <= 64, `${label} must be a bounded key array.`);
  let previous = -1;
  return value.map((entry, index) => {
    requireValue(effectObject(entry), `${label}[${index}] is invalid.`);
    const time = number(entry.RelativeTime, `${label}[${index}].RelativeTime`);
    requireValue(time >= 0 && time <= 1 && time > previous, `${label} times must be strictly increasing in [0,1].`); previous = time;
    if (color) {
      requireValue(effectObject(entry.Color), `${label} color is missing.`);
      const rgba = ["R", "G", "B", "A"].map(axis => number((entry.Color as Record<string, unknown>)[axis], `${label}.${axis}`));
      requireValue(rgba.every(value => Number.isInteger(value) && value >= 0 && value <= 255), `${label} requires RGBA bytes.`);
      return { time, value: rgba.map(value => value / 255) };
    }
    const size = number(entry.RelativeSize, `${label}.RelativeSize`);
    requireValue(size >= 0 && size <= 1e6, `${label} size is unsupported.`);
    return { time, value: [size] };
  });
}
function interpolate(track: readonly Key[], time: number, identity: number[]): number[] {
  if (!track.length) return identity.slice();
  if (time <= track[0]!.time) return track[0]!.value.slice();
  for (let i = 1; i < track.length; i++) {
    const right = track[i]!, left = track[i - 1]!;
    if (time <= right.time) {
      const weight = (time - left.time) / (right.time - left.time);
      return left.value.map((value, channel) => value + (right.value[channel]! - value) * weight);
    }
  }
  return track.at(-1)!.value.slice();
}
/** Stateless keyed sampling: ASCII/source identity hash, then 32-bit avalanche. */
function uniform(seed: number, component: string, index: number, channel: string): number {
  let value = (2166136261 ^ seed) >>> 0;
  const key = `${component}|${index}|${channel}`;
  for (let i = 0; i < key.length; i++) value = Math.imul(value ^ key.charCodeAt(i), 16777619) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d); value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b); value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}
function sample(pair: Range, u: number): number { return pair[0] + (pair[1] - pair[0]) * u; }
function multiply(a: Vec4, b: Vec4): Vec4 {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
function rotation(turns: Vec3): Vec4 {
  const [x, y, z] = turns.map(value => value * Math.PI) as Vec3;
  // Active source rotations X then Y then Z: qZ*qY*qX. Reflection S swaps Y/Z;
  // S*R*S has quaternion vector det(S)*S*q.xyz = (-x,-z,-y).
  const q = multiply(multiply([0, 0, Math.sin(z), Math.cos(z)], [0, Math.sin(y), 0, Math.cos(y)]), [Math.sin(x), 0, 0, Math.cos(x)]);
  const norm = Math.hypot(...q);
  return [-q[0] / norm, -q[2] / norm, -q[1] / norm, q[3] / norm];
}
function unsupportedPaths(p: Record<string, unknown>) {
  for (const field of ["Disabled", "AutoReset", "UseCollision", "UseCollisionPlanes", "UseActorForces", "UseRevolution", "UseRevolutionScale", "VelocityFromMesh", "UseVelocityScale", "DampRotation", "UseSpawnedVelocityScale", "UseRandomSubdivision", "UseSubdivisionScale", "BlendBetweenSubdivisions"]) {
    requireValue(!flag(p, field), `${field}=true is unsupported.`);
  }
  for (const field of ["ParticlesPerSecond", "SpawnOnTriggerPPS", "RelativeWarmupTime", "WarmupTicksPerSecond", "MeshSpawning", "UseRotationFrom", "UseSkeletalLocationAs", "GetVelocityDirectionFrom", "StartLocationShape"]) {
    requireValue(p[field] === undefined || number(p[field], field) === 0, `${field} is unsupported.`);
  }
  for (const field of ["AddLocationFromOtherEmitter", "AddVelocityFromOtherEmitter", "SpawnFromOtherEmitter"]) requireValue(p[field] === -1, `${field} must disable cross-emitter dependencies.`);
  requireValue(constant(p.InitialTimeRange, "InitialTimeRange", 0) === 0, "nonzero initial particle age is unsupported.");
  requireValue(vector(p.Acceleration, "Acceleration", 0).every(value => value === 0), "acceleration is unsupported.");
  if (p.RotationOffset !== undefined) {
    requireValue(effectObject(p.RotationOffset) && ["Pitch", "Yaw", "Roll"].every(axis => p.RotationOffset !== null && number((p.RotationOffset as Record<string, unknown>)[axis], `RotationOffset.${axis}`) === 0), "RotationOffset is unsupported.");
  }
  requireValue(p.TextureUSubdivisions === undefined && p.TextureVSubdivisions === undefined && p.SubdivisionStart === undefined && p.SubdivisionEnd === undefined, "init atlas subdivisions are unsupported.");
  requireValue(p.SizeScaleRepeats === undefined || number(p.SizeScaleRepeats, "SizeScaleRepeats") === 0, "size-key repetition is unsupported.");
  for (const field of ["ForcedLifeTime", "ForcedFade", "ForcedMaxParticles", "TriggerDisabled"]) flag(p, field);
}
interface Prepared {
  component: string; index: number; birth: number; death: number; life: number; sprite: boolean;
  position: Vec3; velocity: Vec3; loss: Vec3; scale: Vec3; startSpin: Vec3; spinRate: Vec3;
  sizeKeys: Key[]; colorKeys: Key[]; cycles: number; fadeIn: number | null; fadeOut: number | null;
  frameCount: number; frameRate: number;
}

/** Pure source-data evaluator. No scene/material allocation, resource reads,
 * mutable frame history, native lifetime inference or gameplay dispatch. */
export function createNativeEffectInitTimeline(bundle: EffectBundle, seed = NATIVE_EFFECT_INIT_DEFAULT_SEED): NativeEffectInitTimeline {
  requireValue(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, "seed must be an unsigned 32-bit integer.");
  const manifest = parseEffectManifest(structuredClone(bundle.manifest));
  requireValue((manifest.id ?? manifest.bundleId) === "interlude:skill:3:level:1:raw-source-dispatch", "unexpected skill bundle.");
  requireValue(/^[a-f0-9]{64}$/.test(bundle.manifestSha256), "missing verified manifest identity.");
  const actor = manifest.actors.find(actor => actor.object === ACTOR);
  requireValue(actor?.dispatchStages?.length === 1 && actor.dispatchStages[0] === "init", "missing exact init actor dispatch.");
  const components = manifest.components.filter(component => component.actor === ACTOR).sort((a, b) => a.emitterOrdinal - b.emitterOrdinal);
  requireValue(components.length === 3, "exact three init components required.");
  const resources = new Map<string, EffectResource>(), prepared: Prepared[] = [];
  for (const [ordinal, component] of components.entries()) {
    const expected = EXPECTED[ordinal]!, p = component.effectiveProperties, sprite = component.class === "Engine.SpriteEmitter";
    requireValue(component.object === `${ACTOR}.${expected.name}` && component.class === expected.type && component.emitterOrdinal === ordinal, "unexpected init component identity/order.");
    unsupportedPaths(p);
    requireValue(p.CoordinateSystem === 1, "only retained PTCS_Relative is supported.");
    requireValue(p.AutomaticInitialSpawning === false && p.RespawnDeadParticles === false, "source emission flags differ.");
    const life = constant(p.LifetimeRange, "LifetimeRange"), delay = constant(p.InitialDelayRange, "InitialDelayRange", 0);
    const count = number(p.MaxParticles, "MaxParticles"), rate = number(p.InitialParticlesPerSecond, "InitialParticlesPerSecond");
    requireValue(life === expected.life && delay === expected.delay && count === expected.count && rate === expected.rate, "retained init count/rate/lifetime/delay differ.");
    const sizes = rangeVector(p.StartSizeRange, "StartSizeRange", 0), midpoint = sizes.map(pair => pair[0] / 2 + pair[1] / 2) as Vec3;
    requireValue(sizes.every(pair => pair[0] > 0) && midpoint.every(value => value > 0 && Number.isFinite(Math.fround(value))), "start size and midpoint must stay positive.");
    const uniformSize = flag(p, "UniformSize"), sizeKeys = keys(p.SizeScale, "SizeScale", false), colorKeys = keys(p.ColorScale, "ColorScale", true);
    const useSize = flag(p, "UseSizeScale"), useColor = flag(p, "UseColorScale");
    requireValue(!useSize || !sizeKeys.length || p.UseRegularSizeScale === false, "only explicit irregular size-key tracks are supported.");
    requireValue(!useColor || colorKeys.length > 0, "enabled color track has no keys.");
    const cycles = p.ColorScaleRepeats === undefined ? 1 : number(p.ColorScaleRepeats, "ColorScaleRepeats");
    requireValue(cycles > 0 && cycles <= 64, "color cycle count is unsupported.");
    const location = vector(p.StartLocationOffset, "StartLocationOffset", 0), locationRange = rangeVector(p.StartLocationRange, "StartLocationRange", -1e6, 0);
    const velocity = rangeVector(p.StartVelocityRange, "StartVelocityRange", -1e6, 0), loss = rangeVector(p.VelocityLossRange, "VelocityLossRange", 0, 0);
    const startSpin = rangeVector(p.StartSpinRange, "StartSpinRange"), spinRate = rangeVector(p.SpinsPerSecondRange, "SpinsPerSecondRange", 0, 0);
    const signs = vector(p.SpinCCWorCW, "SpinCCWorCW"), spin = flag(p, "SpinParticles");
    requireValue(signs.every(value => value >= 0 && value <= 1), "spin sign probabilities must be in [0,1].");
    if (sprite) requireValue([...startSpin.slice(1), ...spinRate.slice(1)].every(pair => pair[0] === 0 && pair[1] === 0), "sprite only supports source X spin.");
    for (const field of ["FadeInFactor", "FadeOutFactor"]) requireValue(effectObject(p[field]) && ["W", ...AXES].every(axis => number((p[field] as Record<string, unknown>)[axis], `${field}.${axis}`) === 1), `${field} must be all ones.`);
    const fadeIn = flag(p, "FadeIn") ? number(p.FadeInEndTime, "FadeInEndTime") : null;
    const fadeOut = flag(p, "FadeOut") ? number(p.FadeOutStartTime, "FadeOutStartTime") : null;
    requireValue((fadeIn === null || (fadeIn >= 0 && fadeIn <= life)) && (fadeOut === null || (fadeOut >= 0 && fadeOut < life)), "fade seconds must fit the particle lifetime.");
    let texture: EffectResource;
    if (sprite) {
      requireValue(component.bindings.texture?.object === expected.texture, "sprite original texture differs."); texture = component.bindings.texture;
    } else {
      requireValue(component.bindings.mesh?.object === expected.mesh && component.bindings.primitiveMaterials.length === 1, "mesh original resource/primitive differs.");
      resources.set(component.bindings.mesh.assetId, component.bindings.mesh);
      texture = manifest.resources[component.bindings.primitiveMaterials[0]!.textureResourceKey]!;
      requireValue(texture.object === expected.texture, "mesh original primitive texture differs.");
    }
    const frames = effectFrames(manifest, component, texture), expectedNames = ordinal === 2 ? [42, 43, 44, 45].map(i => `LineageEffectsTextures.Spark.fx_m_t00${i}`) : [expected.texture];
    requireValue(frames.length === expectedNames.length && frames.every((frame, i) => frame.texture.object === expectedNames[i] && frame.sourceTile === null), "init source frame chain differs.");
    for (const frame of frames) resources.set(frame.texture.assetId, frame.texture);
    const animation = manifest.textureGraph.find(row => row.object === texture.object)?.animationProperties;
    requireValue(animation !== undefined, "original texture graph entry is missing.");
    requireValue(ordinal !== 2 || (animation?.MinFrameRate === 18 && animation.MaxFrameRate === 18 && animation.TotalFrameNum === 4), "charge frame declaration differs.");
    for (let index = 0; index < count; index++) {
      const u = (channel: string) => uniform(seed, component.object, index, channel);
      const sampledSize = sizes.map((pair, axis) => sample(pair, u(uniformSize ? "size" : `size:${AXES[axis]}`)) / midpoint[axis]!) as Vec3;
      const birth = delay + index / rate;
      prepared.push({ component: component.object, index, birth, death: birth + life, life, sprite,
        position: locationRange.map((pair, axis) => location[axis]! + sample(pair, u(`location:${AXES[axis]}`))) as Vec3,
        velocity: velocity.map((pair, axis) => sample(pair, u(`velocity:${AXES[axis]}`))) as Vec3,
        loss: loss.map((pair, axis) => sample(pair, u(`loss:${AXES[axis]}`))) as Vec3,
        scale: sprite ? [sampledSize[0], sampledSize[1], 1] : [sampledSize[0], sampledSize[2], sampledSize[1]],
        startSpin: startSpin.map((pair, axis) => spin ? sample(pair, u(`startSpin:${AXES[axis]}`)) : 0) as Vec3,
        spinRate: spinRate.map((pair, axis) => spin ? sample(pair, u(`spinRate:${AXES[axis]}`)) * (u(`spinSign:${AXES[axis]}`) < signs[axis]! ? -1 : 1) : 0) as Vec3,
        sizeKeys: useSize ? sizeKeys : [], colorKeys: useColor ? colorKeys : [], cycles,
        fadeIn, fadeOut, frameCount: frames.length, frameRate: ordinal === 2 ? 18 : 0 });
    }
  }
  requireValue(prepared.length === 19 && resources.size === 8, "retained init capacity/resource set differs.");
  freeze(components); freeze(prepared); const resourceList = freeze([...resources.values()].sort((a, b) => a.object.localeCompare(b.object)));
  const duration = Math.max(...prepared.map(particle => particle.death));
  return Object.freeze({ policy: NATIVE_EFFECT_INIT_POLICY, seed, components, resources: resourceList, capacity: 19 as const, duration, limitations: LIMITATIONS,
    evaluate(seconds: number): NativeEffectInitEvaluation {
      requireValue(Number.isFinite(seconds) && seconds >= 0, "source seconds must be finite and nonnegative.");
      const particles: NativeEffectParticleState[] = [], diagnostics: NativeEffectInitDiagnostic[] = [];
      let born = 0, expired = 0;
      for (const particle of prepared) {
        if (seconds < particle.birth) continue;
        born++;
        if (seconds >= particle.death) { expired++; continue; }
        const age = seconds - particle.birth, relative = age / particle.life;
        const size = interpolate(particle.sizeKeys, relative, [1])[0]!;
        const cycle = relative * particle.cycles, rgba = interpolate(particle.colorKeys, cycle - Math.floor(cycle), [1, 1, 1, 1]) as Vec4;
        const position = particle.velocity.map((velocity, axis) => particle.position[axis]! + velocity * (particle.loss[axis] === 0 ? age : -Math.expm1(-particle.loss[axis]! * age) / particle.loss[axis]!)) as Vec3;
        const turns = particle.startSpin.map((turn, axis) => turn + particle.spinRate[axis]! * age) as Vec3;
        const fadeIn = particle.fadeIn === null || particle.fadeIn === 0 ? 1 : Math.min(1, age / particle.fadeIn);
        const fadeOut = particle.fadeOut === null || age <= particle.fadeOut ? 1 : Math.max(0, (particle.life - age) / (particle.life - particle.fadeOut));
        particles.push({ component: particle.component, index: particle.index,
          position: [position[0] * .01, position[2] * .01, position[1] * .01],
          scale: particle.sprite ? [particle.scale[0] * size, particle.scale[1] * size, 1] : particle.scale.map(value => value * size) as Vec3,
          rgba, fade: fadeIn * fadeOut, frame: Math.min(particle.frameCount - 1, Math.floor(age * particle.frameRate)),
          quaternion: particle.sprite ? [0, 0, 0, 1] : rotation(turns),
          ...(particle.sprite ? { billboardAngle: turns[0] * 2 * Math.PI } : {}) });
        diagnostics.push({ component: particle.component, index: particle.index, birth: particle.birth, lifetime: particle.life, age });
      }
      return { seconds, particles, diagnostics, born, expired, complete: seconds >= duration };
    },
  });
}
