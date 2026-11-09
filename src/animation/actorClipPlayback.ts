import type { ActorClipEvent } from "../assets/native/actorClipEvents";

export interface ActorClip {
  readonly name: string;
  readonly durationSeconds: number;
  readonly events: readonly ActorClipEvent[];
}

export interface ActorClipListing {
  readonly clips: readonly ActorClip[];
  readonly eventsWithoutClip: readonly ActorClipEvent[];
}

export interface ActorClipPlayer {
  play(clipName: string): void;
  readonly previewing: string | null;
  readonly listing: ActorClipListing;
}

export interface ActorClipListingSource {
  actorClipEntityIds(): readonly string[];
  actorClipListing(entityId: string): ActorClipListing | null;
  previewing(entityId: string): string | null;
}

interface LoadedActorClip {
  readonly name: string;
  readonly durationSeconds: number;
}

type PlayRefusalReasonOrNullWhenPlaying = string | null;

export function listActorClips(loadedClips: readonly LoadedActorClip[], events: readonly ActorClipEvent[]): ActorClipListing {
  const eventsByClipName = new Map<string, ActorClipEvent[]>(loadedClips.map(clip => [clip.name, []]));
  const eventsWithoutClip: ActorClipEvent[] = [];
  for (const event of events) (eventsByClipName.get(event.clip) ?? eventsWithoutClip).push(event);
  return {
    clips: loadedClips.map(clip => ({ name: clip.name, durationSeconds: clip.durationSeconds, events: eventsByClipName.get(clip.name) ?? [] })),
    eventsWithoutClip,
  };
}

export function playActorClip(player: ActorClipPlayer | undefined, clipName: string): PlayRefusalReasonOrNullWhenPlaying {
  if (!player) return "The native model has not loaded yet.";
  if (!player.listing.clips.some(clip => clip.name === clipName)) return `${clipName} is not a clip of this package.`;
  try { player.play(clipName); return null; } catch (error) { return error instanceof Error ? error.message : "The clip could not be played."; }
}
