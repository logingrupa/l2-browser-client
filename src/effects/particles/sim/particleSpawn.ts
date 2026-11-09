import { addVectors, scaleVector, vectorLength, type Vector3 } from "../../../shared/math/vector3";
import { randomRange, randomUnitVector, type RandomStream } from "../../../shared/random";
import { COORDINATE_SYSTEM, PARTICLE_CONSTANTS, ROTATION_SOURCE, START_LOCATION_SHAPE, VELOCITY_DIRECTION } from "./emitterConstants";
import type { FloatRange, RangeVector } from "./emitterRecords";
import { rotateByAxes, rotateByRotators, rotatorAxes } from "./particleRotation";
import { PARTICLE_FLAG, readSlotVector, writeSlotColor, writeSlotVector, type EmitterRuntime, type EmitterStepContext } from "./particleState";

const spinUnitsPerTurn = PARTICLE_CONSTANTS.spinUnitsPerTurn.runtimeDefault;
const respawnPassLimit = PARTICLE_CONSTANTS.respawnLoopGuard.runtimeDefault;
const zeroVector: Vector3 = { x: 0, y: 0, z: 0 };
const unitVector: Vector3 = { x: 1, y: 1, z: 1 };
const degreesToRadians = Math.PI / 180;

export function drawRange(stream: RandomStream, range: FloatRange): number {
  return randomRange(range.min, range.max, stream.nextUnit());
}

export function drawRangeVector(stream: RandomStream, range: RangeVector): Vector3 {
  const x = drawRange(stream, range.x), y = drawRange(stream, range.y), z = drawRange(stream, range.z);
  return { x, y, z };
}

function multiplyComponents(left: Vector3, right: Vector3): Vector3 {
  return { x: left.x * right.x, y: left.y * right.y, z: left.z * right.z };
}

function directionOrZero(vector: Vector3): Vector3 {
  const length = vectorLength(vector);
  return length === 0 ? zeroVector : scaleVector(vector, 1 / length);
}

export function siblingRuntime(context: EmitterStepContext, emitterIndex: number): EmitterRuntime | null {
  if (emitterIndex < 0 || context.siblings.length === 0) return null;
  return context.siblings[Math.min(emitterIndex, context.siblings.length - 1)]!;
}

function spawnLocationShape(runtime: EmitterRuntime): Vector3 {
  const { record, stream } = runtime, shape = record.StartLocationShape;
  let location = record.StartLocationOffset;
  if (shape === START_LOCATION_SHAPE.box || shape === START_LOCATION_SHAPE.all) location = addVectors(location, drawRangeVector(stream, record.StartLocationRange));
  if (shape === START_LOCATION_SHAPE.sphere || shape === START_LOCATION_SHAPE.all) {
    const direction = randomUnitVector(stream);
    location = addVectors(location, scaleVector(direction, drawRange(stream, record.SphereRadiusRange)));
  }
  if (shape === START_LOCATION_SHAPE.polar || shape === START_LOCATION_SHAPE.all) {
    const polar = drawRangeVector(stream, record.StartLocationPolarRange);
    const azimuth = polar.x * degreesToRadians, inclination = polar.y * degreesToRadians;
    location = addVectors(location, scaleVector({ x: Math.sin(inclination) * Math.cos(azimuth), y: Math.sin(inclination) * Math.sin(azimuth), z: Math.cos(inclination) }, polar.z));
  }
  return location;
}

function velocityFromDirectionMode(runtime: EmitterRuntime, location: Vector3, velocity: Vector3): Vector3 {
  const { record, stream } = runtime, mode = record.GetVelocityDirectionFrom;
  if (mode === VELOCITY_DIRECTION.none) return velocity;
  const ownerRelative = record.CoordinateSystem === COORDINATE_SYSTEM.relative || record.CoordinateSystem === COORDINATE_SYSTEM.spray;
  const direction = scaleVector(directionOrZero(location), ownerRelative ? 1 : -1);
  if (mode === VELOCITY_DIRECTION.startPositionAndOwner) return multiplyComponents(scaleVector(velocity, -1), direction);
  if (mode === VELOCITY_DIRECTION.ownerAndStartPosition) return multiplyComponents(velocity, direction);
  return addVectors(velocity, scaleVector(direction, drawRange(stream, record.StartVelocityRadialRange)));
}

function spawnParticleOnce(runtime: EmitterRuntime, slot: number, ageSeconds: number, context: EmitterStepContext, ownerVelocity: Vector3): void {
  const { record, stream, columns, counters } = runtime;
  const spray = record.CoordinateSystem === COORDINATE_SYSTEM.spray, independent = record.CoordinateSystem === COORDINATE_SYSTEM.independent;
  let velocity = drawRangeVector(stream, record.StartVelocityRange);
  let location = spawnLocationShape(runtime);
  counters.otherEmitterCursor += 1;
  const locationSibling = siblingRuntime(context, record.AddLocationFromOtherEmitter);
  if (locationSibling && locationSibling.counters.activeSlots > 0) {
    location = addVectors(location, readSlotVector(locationSibling.columns.location, counters.otherEmitterCursor % locationSibling.counters.activeSlots));
  }
  const rotateFromSource = (vector: Vector3) => record.UseRotationFrom === ROTATION_SOURCE.actor ? rotateByRotators(vector, context.owner.rotation, record.RotationOffset)
    : record.UseRotationFrom === ROTATION_SOURCE.offset ? rotateByAxes(vector, rotatorAxes(record.RotationOffset)) : vector;
  location = rotateFromSource(location);
  const revolutionCenter = drawRangeVector(stream, record.RevolutionCenterOffsetRange), revolutionRate = drawRangeVector(stream, record.RevolutionsPerSecondRange);
  location = addVectors(location, context.globalOffset);
  const startLocation = location;
  const colorMultiplier = drawRangeVector(stream, record.ColorMultiplierRange);
  const maxLifetime = drawRange(stream, record.LifetimeRange);
  const time = ageSeconds + drawRange(stream, record.InitialTimeRange);
  const mass = drawRange(stream, record.StartMassRange);
  const drawnStartSize = drawRangeVector(stream, record.StartSizeRange);
  const startSize = runtime.uniformSize ? { x: drawnStartSize.x, y: drawnStartSize.x, z: drawnStartSize.x } : drawnStartSize;
  velocity = rotateFromSource(addVectors(velocity, scaleVector(record.Acceleration, ageSeconds)));
  const sprayRotation = (vector: Vector3) => rotateByRotators(vector, context.owner.rotation, context.emitterRotation);
  let sprayAcceleration = zeroVector;
  if (spray) {
    location = sprayRotation(location);
    velocity = sprayRotation(velocity);
    sprayAcceleration = record.IndependentSprayAccel ? record.Acceleration : sprayRotation(record.Acceleration);
  }
  velocity = velocityFromDirectionMode(runtime, location, velocity);
  const velocitySibling = siblingRuntime(context, record.AddVelocityFromOtherEmitter);
  if (velocitySibling && velocitySibling.counters.activeSlots > 0) {
    const siblingVelocity = readSlotVector(velocitySibling.columns.velocity, counters.otherEmitterCursor % velocitySibling.counters.activeSlots);
    velocity = addVectors(velocity, multiplyComponents(drawRangeVector(stream, record.AddVelocityMultiplierRange), siblingVelocity));
  }
  if (independent && ageSeconds > 0) location = addVectors(location, scaleVector(ownerVelocity, -ageSeconds));
  location = addVectors(location, scaleVector(velocity, ageSeconds));
  const startSpin = drawRangeVector(stream, record.StartSpinRange), drawnSpinRate = drawRangeVector(stream, record.SpinsPerSecondRange);
  const spinSign = (clockwiseChance: number) => clockwiseChance > stream.nextUnit() ? -1 : 1;
  const spinSignX = spinSign(record.SpinCCWorCW.x), spinSignY = spinSign(record.SpinCCWorCW.y), spinSignZ = spinSign(record.SpinCCWorCW.z);
  const spinRate = { x: drawnSpinRate.x * spinSignX, y: drawnSpinRate.y * spinSignY, z: drawnSpinRate.z * spinSignZ };
  const cellCount = record.TextureUSubdivisions * record.TextureVSubdivisions;
  const subdivision = !record.UseRandomSubdivision ? -1 : record.SubdivisionEnd !== 0
    ? Math.trunc(record.SubdivisionStart + (record.SubdivisionEnd - record.SubdivisionStart) * stream.nextUnit())
    : Math.trunc(stream.nextUnit() * cellCount);
  const worldStored = spray || independent;
  const storedPoint = (point: Vector3, rotated: boolean) => worldStored ? addVectors(spray && !rotated ? sprayRotation(point) : point, context.owner.location) : point;
  writeSlotVector(columns.location, slot, storedPoint(location, true));
  writeSlotVector(columns.oldLocation, slot, storedPoint(startLocation, false));
  writeSlotVector(columns.startLocation, slot, storedPoint(startLocation, false));
  writeSlotVector(columns.revolutionCenter, slot, storedPoint(revolutionCenter, false));
  writeSlotVector(columns.velocity, slot, velocity);
  writeSlotVector(columns.sprayAcceleration, slot, sprayAcceleration);
  writeSlotVector(columns.velocityMultiplier, slot, unitVector);
  writeSlotVector(columns.revolutionMultiplier, slot, unitVector);
  writeSlotVector(columns.revolutionRate, slot, revolutionRate);
  writeSlotVector(columns.colorMultiplier, slot, colorMultiplier);
  writeSlotVector(columns.startSize, slot, startSize);
  writeSlotVector(columns.size, slot, startSize);
  writeSlotVector(columns.startSpin, slot, scaleVector(startSpin, spinUnitsPerTurn));
  writeSlotVector(columns.spinRate, slot, scaleVector(spinRate, spinUnitsPerTurn));
  writeSlotColor(columns, slot, [1, 1, 1, 1]);
  columns.maxLifetime[slot] = Math.fround(maxLifetime);
  columns.time[slot] = Math.fround(time);
  columns.mass[slot] = Math.fround(mass !== 0 ? 1 / mass : 0);
  columns.subdivision[slot] = subdivision;
  columns.flags[slot] = PARTICLE_FLAG.active | PARTICLE_FLAG.justSpawned;
}

export function spawnParticle(runtime: EmitterRuntime, slot: number, ageSeconds: number, context: EmitterStepContext, ownerVelocity: Vector3): void {
  const { record, columns, counters } = runtime;
  if (record.MaxParticles === 0 || record.LifetimeRange.max <= 0) return;
  let spawnAgeSeconds = ageSeconds;
  for (let pass = 0; ; pass += 1) {
    if (pass >= respawnPassLimit) throw new Error(`Emitter ${record.object}: a spawn stayed past MaxLifetime after ${respawnPassLimit} respawn passes.`);
    spawnParticleOnce(runtime, slot, spawnAgeSeconds, context, ownerVelocity);
    const time = columns.time[slot]!, maxLifetime = columns.maxLifetime[slot]!;
    if (!(maxLifetime > 0 && time > maxLifetime)) break;
    spawnAgeSeconds = time % maxLifetime;
  }
  counters.dead = false;
}
