import type { EffectScheduler, ScheduledEffect } from "../effectScheduler";
import type { EmitterActorRecord, ParticleEmitterRecord } from "../sim/emitterRecords";

export interface MapEmitterPlacement {
  readonly placementId: string;
  readonly actor: EmitterActorRecord;
  readonly emitters: readonly ParticleEmitterRecord[];
}

export interface MapEmitterPlacementView {
  setVisible(visible: boolean): void;
  render(effect: ScheduledEffect): void;
  dispose(): void;
}

export interface TileMapEmitterSettings {
  readonly scheduler: EffectScheduler;
  readonly placements: readonly MapEmitterPlacement[];
  readonly isPlacementVisible: (placementId: string) => boolean;
  readonly isPlacementInFrustum: (placementId: string) => boolean;
  readonly createPlacementView: (placement: MapEmitterPlacement) => MapEmitterPlacementView;
}

export interface TileMapEmitterInspection {
  readonly placements: readonly { readonly placementId: string; readonly effectSerial: number; readonly visible: boolean; readonly destroyed: boolean }[];
}

export interface TileMapEmitterPlayback {
  update(): void;
  inspect(): TileMapEmitterInspection;
  dispose(): void;
}

interface PlayingPlacement {
  readonly placement: MapEmitterPlacement;
  readonly effect: ScheduledEffect;
  readonly view: MapEmitterPlacementView;
  visible: boolean;
}

export function mapEmitterOwnerKey(placementId: string): string {
  return `map-emitter:${placementId}`;
}

export function playTileMapEmitters(settings: TileMapEmitterSettings): TileMapEmitterPlayback {
  const placementIds = settings.placements.map(placement => placement.placementId);
  if (new Set(placementIds).size !== placementIds.length) throw new Error(`Tile map emitters: placement ids repeat in ${placementIds.join(", ")}.`);
  const playing: PlayingPlacement[] = [];
  let disposed = false;
  try {
    for (const placement of settings.placements) {
      const effect = settings.scheduler.spawnEffect(placement.actor, placement.emitters, mapEmitterOwnerKey(placement.placementId));
      const view = settings.createPlacementView(placement);
      view.setVisible(false);
      playing.push({ placement, effect, view, visible: false });
    }
  } catch (error) {
    for (const entry of playing) { settings.scheduler.removeEffect(entry.effect); entry.view.dispose(); }
    throw error;
  }
  return {
    update() {
      if (disposed) return;
      for (const entry of playing) {
        const { placementId } = entry.placement;
        const visible = !entry.effect.actor.destroyed && settings.isPlacementVisible(placementId) && settings.isPlacementInFrustum(placementId);
        if (visible !== entry.visible) { entry.visible = visible; entry.view.setVisible(visible); }
        if (visible) entry.view.render(entry.effect);
      }
    },
    inspect: () => ({
      placements: playing.map(entry => ({ placementId: entry.placement.placementId, effectSerial: entry.effect.effectSerial, visible: entry.visible, destroyed: entry.effect.actor.destroyed })),
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of playing) { settings.scheduler.removeEffect(entry.effect); entry.view.dispose(); }
    },
  };
}
