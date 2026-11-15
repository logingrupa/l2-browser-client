import { playActorClip, type ActorClipListingSource, type ActorClipPlayer } from "../../animation/actorClipPlayback";

type PlayRefusalReasonOrNullWhenPlaying = string | null;
type UnregisterPreviewPlayer = () => void;

export interface NativeClipPreviewHub extends ActorClipListingSource {
  play(entityId: string, clip: string): PlayRefusalReasonOrNullWhenPlaying;
  actorClipPlayer(entityId: string): ActorClipPlayer | undefined;
  register(entityId: string, player: ActorClipPlayer): UnregisterPreviewPlayer;
}

export function createNativeClipPreviewHub(): NativeClipPreviewHub {
  const players = new Map<string, ActorClipPlayer>();
  return {
    play: (entityId, clip) => playActorClip(players.get(entityId), clip),
    actorClipPlayer: entityId => players.get(entityId),
    previewing: entityId => players.get(entityId)?.previewing ?? null,
    actorClipEntityIds: () => [...players.keys()],
    actorClipListing: entityId => players.get(entityId)?.listing ?? null,
    register(entityId, player) {
      players.set(entityId, player);
      return () => { if (players.get(entityId) === player) players.delete(entityId); };
    },
  };
}
