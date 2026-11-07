import { effectFrames, effectObject, parseEffectManifest, type EffectBundle, type EffectComponent, type EffectResource } from "./nativeEffectComponents";
import type { NativeEffectParticleState } from "./nativeEffectParticlePool";

type Vec3 = [number, number, number];
type Vec4 = [number, number, number, number];
type Range = readonly [number, number];
type Ranges = readonly [Range, Range, Range];
type Key = { time: number; value: number[] };
const AXES = ["X", "Y", "Z"] as const;
const ACTOR = "lineageeffect.p_u004_a";
const EXPECTED = [
  { name: "SpriteEmitter9", type: "Engine.SpriteEmitter", count: 8, rate: 10000, life: .3,
    mesh: null, texture: "LineageEffectsTextures.Particles.fx_m_t0061" },
  { name: "MeshEmitter15", type: "Engine.MeshEmitter", count: 1, rate: 1000, life: .2,
    mesh: "LineageEffectsStaticmeshes.Impact.shockwave00", texture: "LineageEffectsTextures.Particles.fx_m_t0006" },
  { name: "MeshEmitter16", type: "Engine.MeshEmitter", count: 2, rate: 10000, life: .3,
    mesh: "LineageEffectsStaticmeshes.Impact.sparkredcone00", texture: "LineageEffectsTextures.Particles.fx_m_t0064" },
] as const;
export const NATIVE_EFFECT_SHOT_DEFAULT_SEED = 0x50335348;
export const NATIVE_EFFECT_SHOT_POLICY = "modern-source-shot-target-impact-v1" as const;
const LIMITATIONS = [
  "Modern finite shot preview: birth=i/rate, MaxParticles total births, zero absent delay, authored lifetimes; no native adjusted lifetime, respawn or actor AutoReplay.",
  "Manager supplies time since the exact original AttackShot event and an event-time target snapshot. This evaluator does not observe native PendingNotify, select targets, apply gameplay damage or dispatch audio.",
  "Uniform keyed FNV-1a32/avalanche samples match the named init policy, not native RNG; samples remain independent of evaluation order.",
  "Modern polar convention: ProjectionNormal is the axis; polar X is colatitude degrees, Y is azimuth degrees, Z is radius. A deterministic projected Cartesian basis defines zero azimuth. Source +X normal and X=90 produce a transverse YZ ring. SphereRadiusRange is retained but inactive for PTLS_Polar.",
  "StartLocationOffset is added before normalizing owner-origin to spawned-location direction. Sampled velocity XYZ is multiplied componentwise by that direction; source loss uses exponential drag per second. Native polar units, basis, precedence and velocity composition are not proved.",
  "Sprite long/up axis follows current velocity projected into the camera plane by the pool. Returned billboardDirection is normalized local-browser XYZ; no needle spin or extra roll is invented. ProjectionNormal/billboard precedence is a modern policy.",
  "Atlas tiles 2 and 3 use equal particle-age halves, with row-major framing, no blending or replay. Native subdivision control fields are absent, not explicit false.",
  "Enabled size keys interpolate linearly and clamp endpoints. Absent UseColorScale leaves white key arrays inactive; the pool applies original ColorMultiplierRange and Opacity once. Fades are linear per-age ramps.",
  "Mesh start-spin is turns, speed turns/second, keyed sign from SpinCCWorCW; native rotations X then Y then Z are mapped through XZY reflection. These units/order/sign semantics are modern conventions.",
  "Source positions/velocities map XYZ to XZY metres once. Sampled start size is relative to the loader midpoint; only explicit UniformSize shares axes. Actor DrawScale is retained but not applied.",
  "All 11 source particles and five original resource identities are included. No native visible composition, target reaction, audio timing beyond existing separate cues, performance or whole-client parity is certified.",
] as const;
export type NativeEffectShotParticleState = NativeEffectParticleState & {
  readonly billboardDirection?: readonly [number, number, number];
};
export interface NativeEffectShotDiagnostic {
  readonly component: string; readonly index: number; readonly birth: number; readonly lifetime: number; readonly age: number;
}
export interface NativeEffectShotEvaluation {
  readonly seconds: number; readonly particles: readonly NativeEffectShotParticleState[];
  readonly diagnostics: readonly NativeEffectShotDiagnostic[];
  /** Cumulative counts at this sample; not events since the last call. */
  readonly born: number; readonly expired: number; readonly complete: boolean;
}
export interface NativeEffectShotTimeline {
  readonly policy: typeof NATIVE_EFFECT_SHOT_POLICY; readonly seed: number;
  readonly components: readonly EffectComponent[]; readonly resources: readonly EffectResource[];
  readonly capacity: 11; readonly duration: number; readonly limitations: readonly string[];
  evaluate(seconds: number): NativeEffectShotEvaluation;
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Native effect shot timeline: ${message}`);
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
function unit(value: Vec3, label: string): Vec3 {
  const norm = Math.hypot(...value);
  requireValue(Number.isFinite(norm) && norm > 0, `${label} must have a nonzero finite direction.`);
  return value.map(v => v / norm) as Vec3;
}
function dot(a: Vec3, b: Vec3) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function polarPosition(axis: Vec3, angles: Vec3): Vec3 {
  const reference: Vec3 = Math.abs(axis[0]) < .9 ? [1, 0, 0] : [0, 1, 0];
  const projection = dot(reference, axis);
  const tangent = unit(reference.map((v, i) => v - axis[i]! * projection) as Vec3, "polar tangent");
  const second = cross(axis, tangent), theta = angles[0] * Math.PI / 180, phi = angles[1] * Math.PI / 180, radius = angles[2];
  return axis.map((v, i) => radius * (v * Math.cos(theta) + Math.sin(theta) * (tangent[i]! * Math.cos(phi) + second[i]! * Math.sin(phi)))) as Vec3;
}
function unsupportedPaths(p: Record<string, unknown>, sprite: boolean) {
  for (const field of ["Disabled", "AutoReset", "UseCollision", "UseCollisionPlanes", "UseActorForces", "UseRevolution", "UseRevolutionScale", "VelocityFromMesh", "UseVelocityScale", "DampRotation", "UseSpawnedVelocityScale", "UseRandomSubdivision", "UseSubdivisionScale", "BlendBetweenSubdivisions"]) requireValue(!flag(p, field), `${field}=true is unsupported.`);
  for (const field of ["ParticlesPerSecond", "SpawnOnTriggerPPS", "RelativeWarmupTime", "WarmupTicksPerSecond", "MeshSpawning", "UseRotationFrom", "UseSkeletalLocationAs"]) requireValue(p[field] === undefined || number(p[field], field) === 0, `${field} is unsupported.`);
  for (const field of ["AddLocationFromOtherEmitter", "AddVelocityFromOtherEmitter", "SpawnFromOtherEmitter"]) requireValue(p[field] === -1, `${field} must disable cross-emitter dependencies.`);
  requireValue(constant(p.InitialTimeRange, "InitialTimeRange", 0) === 0, "nonzero initial age is unsupported.");
  requireValue(vector(p.Acceleration, "Acceleration", 0).every(value => value === 0), "acceleration is unsupported.");
  requireValue(p.RotationOffset === undefined, "RotationOffset is unsupported.");
  requireValue(p.SizeScaleRepeats === undefined || number(p.SizeScaleRepeats, "SizeScaleRepeats") === 0, "size-key repeats are unsupported.");
  requireValue(!flag(p, "UseColorScale"), "shot color-key enabling differs from retained source.");
  if (sprite) {
    requireValue(p.StartLocationShape === 2 && p.GetVelocityDirectionFrom === 2 && p.UseDirectionAs === 1, "retained polar/direction modes differ.");
    requireValue(!flag(p, "SpinParticles") && p.StartSpinRange === undefined && p.SpinsPerSecondRange === undefined, "needle spin is unsupported.");
    requireValue(p.TextureUSubdivisions === 2 && p.TextureVSubdivisions === 2 && p.SubdivisionStart === 2 && p.SubdivisionEnd === 3, "needle atlas declaration differs.");
  } else {
    for (const field of ["StartLocationShape", "GetVelocityDirectionFrom", "UseDirectionAs"]) requireValue(p[field] === undefined || p[field] === 0, `${field} is unsupported for mesh emitters.`);
    requireValue(p.TextureUSubdivisions === undefined && p.TextureVSubdivisions === undefined && p.SubdivisionStart === undefined && p.SubdivisionEnd === undefined, "mesh atlas subdivisions are unsupported.");
  }
  for (const field of ["ForcedLifeTime", "ForcedFade", "ForcedMaxParticles", "TriggerDisabled"]) flag(p, field);
}
interface Prepared {
  component: string; index: number; birth: number; death: number; life: number; sprite: boolean;
  position: Vec3; velocity: Vec3; loss: Vec3; scale: Vec3; startSpin: Vec3; spinRate: Vec3;
  sizeKeys: Key[]; fadeIn: number | null; fadeOut: number | null;
}
/** Pure source-data timeline; time, target snapshot, rendering and audio are owned by callers. */
export function createNativeEffectShotTimeline(bundle: EffectBundle, seed = NATIVE_EFFECT_SHOT_DEFAULT_SEED): NativeEffectShotTimeline {
  requireValue(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, "seed must be an unsigned 32-bit integer.");
  const manifest = parseEffectManifest(structuredClone(bundle.manifest));
  requireValue((manifest.id ?? manifest.bundleId) === "interlude:skill:3:level:1:raw-source-dispatch", "unexpected skill bundle.");
  requireValue(/^[a-f0-9]{64}$/.test(bundle.manifestSha256), "missing verified manifest identity.");
  const actor = manifest.actors.find(actor => actor.object === ACTOR);
  requireValue(actor?.dispatchStages?.length === 1 && actor.dispatchStages[0] === "shot", "missing exact shot actor dispatch.");
  const components = manifest.components.filter(component => component.actor === ACTOR).sort((a, b) => a.emitterOrdinal - b.emitterOrdinal);
  requireValue(components.length === 3, "exact three shot components required.");
  const resources = new Map<string, EffectResource>(), prepared: Prepared[] = [];
  for (const [ordinal, component] of components.entries()) {
    const expected = EXPECTED[ordinal]!, p = component.effectiveProperties, sprite = component.class === "Engine.SpriteEmitter";
    requireValue(component.object === `${ACTOR}.${expected.name}` && component.class === expected.type && component.emitterOrdinal === ordinal, "unexpected shot component identity/order.");
    unsupportedPaths(p, sprite);
    requireValue(p.CoordinateSystem === 1, "only retained PTCS_Relative is supported.");
    requireValue(p.AutomaticInitialSpawning === false && p.RespawnDeadParticles === false, "source emission flags differ.");
    const life = constant(p.LifetimeRange, "LifetimeRange"), delay = constant(p.InitialDelayRange, "InitialDelayRange", 0);
    const count = number(p.MaxParticles, "MaxParticles"), rate = number(p.InitialParticlesPerSecond, "InitialParticlesPerSecond");
    requireValue(life === expected.life && delay === 0 && count === expected.count && rate === expected.rate, "retained shot count/rate/lifetime/delay differ.");
    const sizes = rangeVector(p.StartSizeRange, "StartSizeRange", 0), midpoint = sizes.map(pair => pair[0] / 2 + pair[1] / 2) as Vec3;
    requireValue(sizes.every(pair => pair[0] > 0), "start size must stay positive.");
    const uniformSize = flag(p, "UniformSize"), useSize = flag(p, "UseSizeScale"), sizeKeys = keys(p.SizeScale, "SizeScale", false);
    requireValue(!useSize || !sizeKeys.length || p.UseRegularSizeScale === false, "only explicit irregular size-key tracks are supported.");
    const location = vector(p.StartLocationOffset, "StartLocationOffset", 0), locationRange = rangeVector(p.StartLocationRange, "StartLocationRange", -1e6, 0);
    const velocity = rangeVector(p.StartVelocityRange, "StartVelocityRange", -1e6, 0), loss = rangeVector(p.VelocityLossRange, "VelocityLossRange", 0, 0);
    const startSpin = rangeVector(p.StartSpinRange, "StartSpinRange", -1e6, 0), spinRate = rangeVector(p.SpinsPerSecondRange, "SpinsPerSecondRange", 0, 0);
    const signs = vector(p.SpinCCWorCW, "SpinCCWorCW"), spin = flag(p, "SpinParticles");
    requireValue(signs.every(v => v >= 0 && v <= 1), "spin probabilities must be in [0,1].");
    const polar = sprite ? rangeVector(p.StartLocationPolarRange, "StartLocationPolarRange", 0) : null;
    const axis = sprite ? unit(vector(p.ProjectionNormal, "ProjectionNormal"), "ProjectionNormal") : null;
    if (sprite) requireValue(polar![0][1] <= 180 && polar![1][1] <= 360 && polar![2][0] > 0 && velocity.every(pair => pair[0] > 0), "polar angles/radius or directional speed are unsupported.");
    for (const field of ["FadeInFactor", "FadeOutFactor"]) requireValue(effectObject(p[field]) && ["W", ...AXES].every(a => number((p[field] as Record<string, unknown>)[a], `${field}.${a}`) === 1), `${field} must be all ones.`);
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
    const frames = effectFrames(manifest, component, texture);
    requireValue(frames.length === (sprite ? 2 : 1) && frames.every((frame, i) => frame.texture.object === expected.texture && frame.sourceTile === (sprite ? i + 2 : null)), "shot frame chain differs.");
    requireValue(manifest.textureGraph.some(row => row.object === texture.object), "original texture graph entry is missing.");
    for (const frame of frames) resources.set(frame.texture.assetId, frame.texture);
    for (let index = 0; index < count; index++) {
      const u = (channel: string) => uniform(seed, component.object, index, channel);
      const sampledSize = sizes.map((pair, i) => sample(pair, u(uniformSize ? "size" : `size:${AXES[i]}`)) / midpoint[i]!) as Vec3;
      let position = locationRange.map((pair, i) => location[i]! + sample(pair, u(`location:${AXES[i]}`))) as Vec3;
      let speed = velocity.map((pair, i) => sample(pair, u(`velocity:${AXES[i]}`))) as Vec3;
      if (sprite) {
        const polarOffset = polarPosition(axis!, polar!.map((pair, i) => sample(pair, u(`polar:${AXES[i]}`))) as Vec3);
        position = position.map((value, i) => value + polarOffset[i]!) as Vec3;
        const direction = unit(position, "owner-to-start");
        speed = speed.map((value, i) => value * direction[i]!) as Vec3;
      }
      const birth = index / rate;
      prepared.push({ component: component.object, index, birth, death: birth + life, life, sprite, position, velocity: speed,
        loss: loss.map((pair, i) => sample(pair, u(`loss:${AXES[i]}`))) as Vec3,
        scale: sprite ? [sampledSize[0], sampledSize[1], 1] : [sampledSize[0], sampledSize[2], sampledSize[1]],
        startSpin: startSpin.map((pair, i) => spin ? sample(pair, u(`startSpin:${AXES[i]}`)) : 0) as Vec3,
        spinRate: spinRate.map((pair, i) => spin ? sample(pair, u(`spinRate:${AXES[i]}`)) * (u(`spinSign:${AXES[i]}`) < signs[i]! ? -1 : 1) : 0) as Vec3,
        sizeKeys: useSize ? sizeKeys : [], fadeIn, fadeOut });
    }
  }
  requireValue(prepared.length === 11 && resources.size === 5, "retained shot capacity/resource set differs.");
  freeze(components); freeze(prepared); const resourceList = freeze([...resources.values()].sort((a, b) => a.object.localeCompare(b.object)));
  const duration = Math.max(...prepared.map(particle => particle.death));
  return Object.freeze({ policy: NATIVE_EFFECT_SHOT_POLICY, seed, components, resources: resourceList, capacity: 11 as const, duration, limitations: LIMITATIONS,
    evaluate(seconds: number): NativeEffectShotEvaluation {
      requireValue(Number.isFinite(seconds) && seconds >= 0, "source seconds must be finite and nonnegative.");
      const particles: NativeEffectShotParticleState[] = [], diagnostics: NativeEffectShotDiagnostic[] = [];
      let born = 0, expired = 0;
      for (const particle of prepared) {
        if (seconds < particle.birth) continue;
        born++;
        if (seconds >= particle.death) { expired++; continue; }
        const age = seconds - particle.birth, relative = age / particle.life;
        const size = interpolate(particle.sizeKeys, relative, [1])[0]!;
        const position = particle.velocity.map((velocity, i) => particle.position[i]! + velocity * (particle.loss[i] === 0 ? age : -Math.expm1(-particle.loss[i]! * age) / particle.loss[i]!)) as Vec3;
        const turns = particle.startSpin.map((turn, i) => turn + particle.spinRate[i]! * age) as Vec3;
        const fadeIn = particle.fadeIn === null || particle.fadeIn === 0 ? 1 : Math.min(1, age / particle.fadeIn);
        const fadeOut = particle.fadeOut === null || age <= particle.fadeOut ? 1 : Math.max(0, (particle.life - age) / (particle.life - particle.fadeOut));
        const currentVelocity = particle.velocity.map((value, i) => value * Math.exp(-particle.loss[i]! * age)) as Vec3;
        particles.push({ component: particle.component, index: particle.index,
          position: [position[0] * .01, position[2] * .01, position[1] * .01],
          scale: particle.sprite ? [particle.scale[0] * size, particle.scale[1] * size, 1] : particle.scale.map(value => value * size) as Vec3,
          rgba: [1, 1, 1, 1], fade: fadeIn * fadeOut, frame: particle.sprite && relative >= .5 ? 1 : 0,
          quaternion: particle.sprite ? [0, 0, 0, 1] : rotation(turns),
          ...(particle.sprite ? { billboardDirection: unit([currentVelocity[0], currentVelocity[2], currentVelocity[1]], "current needle velocity") } : {}) });
        diagnostics.push({ component: particle.component, index: particle.index, birth: particle.birth, lifetime: particle.life, age });
      }
      return { seconds, particles, diagnostics, born, expired, complete: seconds >= duration };
    },
  });
}
