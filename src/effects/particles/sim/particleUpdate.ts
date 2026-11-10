import { addVectors, scaleVector, subtractVectors, vectorLength, type Vector3 } from "../../../shared/math/vector3";
import { COORDINATE_SYSTEM, DRAW_STYLE, PARTICLE_CONSTANTS } from "./emitterConstants";
import { curvePhase, relativeParticleAge, sampleCurve } from "./particleCurves";
import { revolveAboutAxes } from "./particleRotation";
import { drawRange, drawRangeVector, rangeCenter, spawnParticle } from "./particleSpawn";
import {
  PARTICLE_FLAG, hasParticleFlag, readSlotVector, setParticleFlag, writeSlotColor, writeSlotVector,
  type EmitterRuntime, type EmitterStepContext,
} from "./particleState";

const independentPathThreshold = PARTICLE_CONSTANTS.independentPathThreshold.runtimeDefault;
const ownerVelocityStepClamp = PARTICLE_CONSTANTS.ownerVelocityStepClamp.runtimeDefault;
const colorByteScale = PARTICLE_CONSTANTS.colorCurveByteScale.runtimeDefault;
const modulatedFadeGray = PARTICLE_CONSTANTS.modulatedFadeGray.runtimeDefault;
const identityVector = [1, 1, 1] as const;
const whiteBytes = [colorByteScale, colorByteScale, colorByteScale, colorByteScale] as const;
const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

function baseSpawnRate(runtime: EmitterRuntime): number {
  const { record, counters } = runtime;
  if (counters.activeSlots >= record.MaxParticles) return Math.fround(record.ParticlesPerSecond);
  if (!record.AutomaticInitialSpawning) return Math.fround(record.InitialParticlesPerSecond);
  const lifetimeCenter = rangeCenter(record.LifetimeRange);
  return lifetimeCenter > 0 ? Math.fround(record.MaxParticles / lifetimeCenter) : 0;
}

function spawnRate(runtime: EmitterRuntime): number {
  const rate = baseSpawnRate(runtime);
  return runtime.counters.spawnOnTrigger > 0 ? Math.fround(rate + runtime.record.SpawnOnTriggerPPS) : rate;
}

function spawnIntoNextSlot(runtime: EmitterRuntime, ageSeconds: number, context: EmitterStepContext, ownerVelocity: Vector3): number | null {
  const { record, counters } = runtime;
  const slot = counters.nextSlot;
  if (!spawnParticle(runtime, slot, ageSeconds, context, ownerVelocity)) return null;
  counters.activeSlots = Math.max(counters.activeSlots, slot + 1);
  counters.nextSlot = (slot + 1) % record.MaxParticles;
  return slot;
}

function spawnDueParticles(runtime: EmitterRuntime, stepSeconds: number, rate: number, context: EmitterStepContext, ownerDisplacement: Vector3, ownerVelocity: Vector3): void {
  const { record, columns, counters } = runtime;
  const leftoverBeforeStep = counters.spawnFraction, birthStepSeconds = Math.fround(stepSeconds);
  const owedParticles = Math.fround(rate * birthStepSeconds + leftoverBeforeStep);
  const wholeParticlesOwed = Math.floor(owedParticles);
  counters.spawnFraction = Math.fround(owedParticles - wholeParticlesOwed);
  const owedWithinMaximum = Math.min(record.MaxParticles, Math.max(0, wholeParticlesOwed));
  const birthCount = counters.spawnOnTrigger > 0 ? Math.min(owedWithinMaximum, counters.spawnOnTrigger) : owedWithinMaximum;
  if (counters.spawnOnTrigger > 0) counters.spawnOnTrigger -= birthCount;
  const secondsBetweenBirths = Math.fround(1 / rate);
  const firstBirthAgeSeconds = Math.fround(secondsBetweenBirths * leftoverBeforeStep + birthStepSeconds - secondsBetweenBirths);
  const birthSlots: number[] = [];
  for (let birthOrdinal = 0; birthOrdinal < birthCount; birthOrdinal += 1) {
    const slot = spawnIntoNextSlot(runtime, Math.fround(firstBirthAgeSeconds - birthOrdinal * secondsBetweenBirths), context, ownerVelocity);
    if (slot !== null) birthSlots.push(slot);
  }
  if (record.CoordinateSystem !== COORDINATE_SYSTEM.independent || vectorLength(ownerDisplacement) <= independentPathThreshold) return;
  birthSlots.forEach((slot, birthOrdinal) => {
    const pathShift = scaleVector(ownerDisplacement, -(1 - (birthOrdinal + 1) / birthCount));
    writeSlotVector(columns.location, slot, addVectors(readSlotVector(columns.location, slot), pathShift));
  });
}

function moveParticle(runtime: EmitterRuntime, slot: number, stepSeconds: number): void {
  const { record, columns } = runtime;
  const acceleration = record.CoordinateSystem === COORDINATE_SYSTEM.spray ? readSlotVector(columns.sprayAcceleration, slot) : record.Acceleration;
  const velocity = addVectors(readSlotVector(columns.velocity, slot), scaleVector(acceleration, stepSeconds));
  writeSlotVector(columns.velocity, slot, velocity);
  const location = readSlotVector(columns.location, slot), multiplier = readSlotVector(columns.velocityMultiplier, slot);
  writeSlotVector(columns.oldLocation, slot, location);
  let moved = addVectors(location, { x: velocity.x * multiplier.x * stepSeconds, y: velocity.y * multiplier.y * stepSeconds, z: velocity.z * multiplier.z * stepSeconds });
  if (record.UseRevolution) {
    const center = readSlotVector(columns.revolutionCenter, slot), rate = readSlotVector(columns.revolutionRate, slot);
    const revolutionMultiplier = readSlotVector(columns.revolutionMultiplier, slot);
    const turns = { x: rate.x * revolutionMultiplier.x * stepSeconds, y: rate.y * revolutionMultiplier.y * stepSeconds, z: rate.z * revolutionMultiplier.z * stepSeconds };
    moved = addVectors(center, revolveAboutAxes(subtractVectors(moved, center), turns));
  }
  writeSlotVector(columns.location, slot, moved);
}

function applyCurves(runtime: EmitterRuntime, slot: number): void {
  const { record, columns } = runtime;
  const time = columns.time[slot]!, maxLifetime = columns.maxLifetime[slot]!, relativeAge = relativeParticleAge(time, maxLifetime);
  let sizeFactor = 1;
  if (record.UseSizeScale && record.UseRegularSizeScale) sizeFactor = 1 / (1 + time);
  else if (record.UseSizeScale && record.SizeScale.length > 0) {
    const sample = sampleCurve(record.SizeScale, curvePhase(relativeAge, record.SizeScaleRepeats), [1]);
    sizeFactor = sample.pastLastKey ? 1 : sample.values[0]!;
  }
  writeSlotVector(columns.size, slot, scaleVector(readSlotVector(columns.startSize, slot), sizeFactor));
  if (record.UseVelocityScale && maxLifetime > 0 && record.VelocityScale.length > 1) {
    const [x, y, z] = sampleCurve(record.VelocityScale, curvePhase(relativeAge, record.VelocityScaleRepeats), identityVector).values;
    writeSlotVector(columns.velocityMultiplier, slot, { x: x!, y: y!, z: z! });
  }
  if (record.UseRevolutionScale && maxLifetime > 0 && record.RevolutionScale.length > 0) {
    const [x, y, z] = sampleCurve(record.RevolutionScale, curvePhase(relativeAge, record.RevolutionScaleRepeats), identityVector).values;
    writeSlotVector(columns.revolutionMultiplier, slot, { x: x!, y: y!, z: z! });
  }
}

function particleColor(runtime: EmitterRuntime, slot: number): [number, number, number, number] {
  const { record, columns } = runtime;
  const time = columns.time[slot]!, maxLifetime = columns.maxLifetime[slot]!, drawStyle = record.DrawStyle;
  let rgba: [number, number, number, number] = [1, 1, 1, 1];
  if (record.UseColorScale && maxLifetime > 0 && record.ColorScale.length > 1) {
    const sample = sampleCurve(record.ColorScale, curvePhase(relativeParticleAge(time, maxLifetime), record.ColorScaleRepeats), whiteBytes);
    if (!sample.pastLastKey) {
      const [red, green, blue, alpha] = sample.values.map(channel => Math.trunc(channel) / colorByteScale);
      rgba = [red!, green!, blue!, drawStyle === DRAW_STYLE.alphaBlend ? alpha! : 1];
    }
  }
  if (!record.RespawnDeadParticles && record.ParticlesPerSecond === 0 && record.InitialParticlesPerSecond === 0) {
    rgba = [rgba[0] * record.Opacity, rgba[1] * record.Opacity, rgba[2] * record.Opacity, rgba[3]];
  }
  const multiplier = readSlotVector(columns.colorMultiplier, slot);
  rgba = [rgba[0] * multiplier.x, rgba[1] * multiplier.y, rgba[2] * multiplier.z, rgba[3]];
  const fadeOut = record.FadeOut && time > record.FadeOutStartTime && maxLifetime !== record.FadeOutStartTime;
  const fadeIn = !fadeOut && record.FadeIn && record.FadeInEndTime !== 0 && time < record.FadeInEndTime;
  if (fadeOut || fadeIn) {
    const fraction = fadeOut ? (time - record.FadeOutStartTime) / (maxLifetime - record.FadeOutStartTime) : (record.FadeInEndTime - time) / record.FadeInEndTime;
    const factor = fadeOut ? record.FadeOutFactor : record.FadeInFactor;
    if (drawStyle === DRAW_STYLE.modulated) rgba = [modulatedFadeGray, modulatedFadeGray, modulatedFadeGray, 1 - fraction * factor.w];
    else if (drawStyle === DRAW_STYLE.alphaBlend) rgba = [rgba[0], rgba[1], rgba[2], rgba[3] - fraction * factor.w];
    else rgba = [rgba[0] - fraction * factor.x, rgba[1] - fraction * factor.y, rgba[2] - fraction * factor.z, rgba[3] - fraction * factor.w];
  }
  rgba = rgba.map(clampUnit) as [number, number, number, number];
  if (record.Opacity < 1 && drawStyle !== DRAW_STYLE.regular) {
    const alphaChannel = drawStyle === DRAW_STYLE.alphaBlend || drawStyle === DRAW_STYLE.modulated || drawStyle === DRAW_STYLE.alphaModulate;
    rgba = alphaChannel ? [rgba[0], rgba[1], rgba[2], rgba[3] * record.Opacity] : [rgba[0] * record.Opacity, rgba[1] * record.Opacity, rgba[2] * record.Opacity, rgba[3]];
  }
  return rgba;
}

function limitVelocity(runtime: EmitterRuntime, slot: number, stepSeconds: number): void {
  const { record, stream, columns } = runtime;
  const clampAxis = (value: number, limit: number) => limit !== 0 ? Math.min(Math.abs(limit), Math.max(-Math.abs(limit), value)) : value;
  const velocity = readSlotVector(columns.velocity, slot), limit = record.MaxAbsVelocity;
  const clamped = { x: clampAxis(velocity.x, limit.x), y: clampAxis(velocity.y, limit.y), z: clampAxis(velocity.z, limit.z) };
  const loss = drawRangeVector(stream, record.VelocityLossRange);
  writeSlotVector(columns.velocity, slot, {
    x: clamped.x - clamped.x * loss.x * stepSeconds, y: clamped.y - clamped.y * loss.y * stepSeconds, z: clamped.z - clamped.z * loss.z * stepSeconds,
  });
}

function advanceParticleInSlot(runtime: EmitterRuntime, slot: number, stepSeconds: number, context: EmitterStepContext, ownerVelocity: Vector3): boolean {
  const { record, stream, columns } = runtime;
  if (!hasParticleFlag(columns, slot, PARTICLE_FLAG.active)) return false;
  if (!hasParticleFlag(columns, slot, PARTICLE_FLAG.justSpawned)) columns.time[slot] = Math.fround(columns.time[slot]! + stepSeconds);
  const time = columns.time[slot]!, maxLifetime = columns.maxLifetime[slot]!;
  if (time > maxLifetime) {
    if (!record.RespawnDeadParticles) {
      setParticleFlag(columns, slot, PARTICLE_FLAG.active, false);
      return false;
    }
    const respawnAge = maxLifetime > 0 ? (time - maxLifetime + drawRange(stream, record.InitialTimeRange)) % maxLifetime : 0;
    spawnParticle(runtime, slot, respawnAge, context, ownerVelocity);
  }
  if (hasParticleFlag(columns, slot, PARTICLE_FLAG.justSpawned)) setParticleFlag(columns, slot, PARTICLE_FLAG.justSpawned, false);
  else moveParticle(runtime, slot, stepSeconds);
  applyCurves(runtime, slot);
  writeSlotColor(columns, slot, particleColor(runtime, slot));
  limitVelocity(runtime, slot, stepSeconds);
  return true;
}

export function updateParticles(runtime: EmitterRuntime, stepSeconds: number, context: EmitterStepContext): void {
  const { record, counters } = runtime;
  const ownerDisplacement = subtractVectors(context.owner.location, counters.lastOwnerLocation);
  const ownerStepSeconds = Math.min(ownerVelocityStepClamp.maximum, Math.max(ownerVelocityStepClamp.minimum, counters.lastStepSeconds));
  const ownerVelocity = scaleVector(ownerDisplacement, 1 / ownerStepSeconds);
  const rate = spawnRate(runtime);
  if (rate > 0 && !counters.killPending) spawnDueParticles(runtime, stepSeconds, rate, context, ownerDisplacement, ownerVelocity);
  const visitedSlotCount = Math.min(counters.activeSlots, record.MaxParticles);
  let deadCount = 0;
  for (let slot = 0; slot < visitedSlotCount; slot += 1) {
    if (!advanceParticleInSlot(runtime, slot, stepSeconds, context, ownerVelocity)) deadCount += 1;
  }
  const everySlotDead = deadCount >= record.MaxParticles || counters.activeSlots - deadCount <= 0;
  counters.dead = everySlotDead && (counters.killPending || rate === 0 && !record.RespawnDeadParticles);
  counters.lastOwnerLocation = context.owner.location;
  counters.lastStepSeconds = stepSeconds;
  runtime.classOverrides?.afterUpdateParticles(runtime, stepSeconds, context);
}
