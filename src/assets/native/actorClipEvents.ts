export interface ActorClipEvent {
  readonly ordinal: number;
  readonly animationSet: string;
  readonly clip: string;
  readonly normalizedTime: number;
  readonly timeSeconds: number;
  readonly type: string;
  readonly notifyObject: string | null;
  readonly notifyFunction: string;
  readonly sound: string | null;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly sourceFrames: number;
  readonly sourceRate: number;
  readonly timingBasis: string;
}

export class ActorClipEventsError extends Error {
  readonly ordinal: number | null;
  readonly field: string;

  constructor(ordinal: number | null, field: string) {
    super(ordinal === null ? `asset.json ${field} must be a list.` : `asset.json animationEvents[${ordinal}].${field} is missing or invalid.`);
    this.name = "ActorClipEventsError";
    this.ordinal = ordinal;
    this.field = field;
  }
}

type SourceEventRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is SourceEventRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireText(source: SourceEventRecord, ordinal: number, field: string): string {
  const value = source[field];
  if (typeof value !== "string") throw new ActorClipEventsError(ordinal, field);
  return value;
}

function requireTextOrNull(source: SourceEventRecord, ordinal: number, field: string): string | null {
  const value = source[field];
  if (value !== null && typeof value !== "string") throw new ActorClipEventsError(ordinal, field);
  return value;
}

function requireNumberWithin(source: SourceEventRecord, ordinal: number, field: string, accepts: (value: number) => boolean): number {
  const value = source[field];
  if (typeof value !== "number" || !Number.isFinite(value) || !accepts(value)) throw new ActorClipEventsError(ordinal, field);
  return value;
}

function requireFiniteNumber(source: SourceEventRecord, ordinal: number, field: string): number {
  return requireNumberWithin(source, ordinal, field, () => true);
}

function requirePositiveFiniteNumber(source: SourceEventRecord, ordinal: number, field: string): number {
  return requireNumberWithin(source, ordinal, field, value => value > 0);
}

function requireProperties(source: SourceEventRecord, ordinal: number): Readonly<Record<string, unknown>> {
  const value = source.properties;
  if (!isPlainRecord(value)) throw new ActorClipEventsError(ordinal, "properties");
  return structuredClone(value);
}

function parseActorClipEvent(source: unknown, ordinal: number): ActorClipEvent {
  if (!isPlainRecord(source)) throw new ActorClipEventsError(ordinal, "event");
  return {
    ordinal,
    animationSet: requireText(source, ordinal, "animationSet"),
    clip: requireText(source, ordinal, "clip"),
    normalizedTime: requireFiniteNumber(source, ordinal, "normalizedTime"),
    timeSeconds: requireFiniteNumber(source, ordinal, "timeSeconds"),
    type: requireText(source, ordinal, "type"),
    notifyObject: requireTextOrNull(source, ordinal, "object"),
    notifyFunction: requireText(source, ordinal, "function"),
    sound: requireTextOrNull(source, ordinal, "sound"),
    properties: requireProperties(source, ordinal),
    sourceFrames: requirePositiveFiniteNumber(source, ordinal, "sourceFrames"),
    sourceRate: requirePositiveFiniteNumber(source, ordinal, "sourceRate"),
    timingBasis: requireText(source, ordinal, "timingBasis"),
  };
}

export function parseActorClipEvents(animationEvents: readonly unknown[] | undefined): readonly ActorClipEvent[] {
  if (animationEvents === undefined) return [];
  if (!Array.isArray(animationEvents)) throw new ActorClipEventsError(null, "animationEvents");
  return animationEvents.map(parseActorClipEvent);
}
