export interface NativeClipPreviewPlayer {
  play(clip: string): void;
  readonly previewing: string | null;
  readonly clips: readonly string[];
}

type PlayRefusalReasonOrNullWhenPlaying = string | null;
type UnregisterPreviewPlayer = () => void;

export interface NativeClipPreviewHub {
  play(entityId: string, clip: string): PlayRefusalReasonOrNullWhenPlaying;
  previewing(entityId: string): string | null;
  available(entityId: string): readonly string[];
  register(entityId: string, player: NativeClipPreviewPlayer): UnregisterPreviewPlayer;
}

export function createNativeClipPreviewHub(): NativeClipPreviewHub {
  const players = new Map<string, NativeClipPreviewPlayer>();
  return {
    play(entityId, clip) {
      const player = players.get(entityId);
      if (!player) return "The native model has not loaded yet.";
      if (!player.clips.includes(clip)) return `${clip} is not a clip of this package.`;
      try { player.play(clip); return null; } catch (error) { return error instanceof Error ? error.message : "The clip could not be played."; }
    },
    previewing: entityId => players.get(entityId)?.previewing ?? null,
    available: entityId => players.get(entityId)?.clips ?? [],
    register(entityId, player) {
      players.set(entityId, player);
      return () => { if (players.get(entityId) === player) players.delete(entityId); };
    },
  };
}
