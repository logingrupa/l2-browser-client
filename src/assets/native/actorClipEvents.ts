export interface ActorClipEvent {
  readonly ordinal: number;
  readonly animationSet: string;
  readonly clip: string;
  readonly normalizedTime: number;
  readonly timeSeconds: number;
  readonly type: string;
  readonly notifyObject: string;
  readonly notifyFunction: string;
  readonly sound: string | null;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly sourceFrames: number;
  readonly sourceRate: number;
  readonly timingBasis: string;
}

type SourceEventRecord = Record<string, unknown>;

function copySourceEvent(source: SourceEventRecord, ordinal: number): ActorClipEvent {
  return {
    ordinal,
    animationSet: source.animationSet as string,
    clip: source.clip as string,
    normalizedTime: source.normalizedTime as number,
    timeSeconds: source.timeSeconds as number,
    type: source.type as string,
    notifyObject: source.object as string,
    notifyFunction: source.function as string,
    sound: source.sound as string | null,
    properties: structuredClone(source.properties) as Readonly<Record<string, unknown>>,
    sourceFrames: source.sourceFrames as number,
    sourceRate: source.sourceRate as number,
    timingBasis: source.timingBasis as string,
  };
}

export function parseActorClipEvents(animationEvents: readonly unknown[] | undefined): readonly ActorClipEvent[] {
  if (animationEvents === undefined) return [];
  return animationEvents.map((source, ordinal) => copySourceEvent(source as SourceEventRecord, ordinal));
}
