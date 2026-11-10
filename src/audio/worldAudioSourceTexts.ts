import type { NativePlacementAudio } from "../assets/native/loadNativeWorldAudio";
import type { WorldMusicInspection } from "./worldMusic";

export const worldAudioConverterStep = "scripts/world/world_audio_step.py";
export const musicUnresolvedOutsideVolumesText = "outside every MusicVolume, silent; default music unresolved";

const mapLabel = (sourceMap: string | null) => sourceMap ?? "the map";

export function musicVolumeSourceText(music: Pick<WorldMusicInspection, "sourceMap" | "volumes" | "trackNames">): string {
  return `${mapLabel(music.sourceMap)} MusicVolume brushes (${music.volumes.length} volumes) → nMusicID → musicinfo.dat strings ` +
    `(${music.trackNames.join(", ")}) → original music/*.ogg, converted by ${worldAudioConverterStep}`;
}

export function placementAudioSummaryText(placementAudio: NativePlacementAudio | null): string {
  if (!placementAudio) return "No StepSound placement audio loaded.";
  const boundReferences = placementAudio.placements.reduce((count, placement) => count + placement.sounds.filter(key => key !== null).length, 0);
  return `${placementAudio.placements.length} placements bind ${boundReferences} StepSound references to ${placementAudio.sounds.size} sounds ` +
    `(${placementAudio.properties.join(", ")}); automatic footstep playback is polish (DEC-OWN-1).`;
}

export function placementAudioSourceText(placementAudio: NativePlacementAudio | null): string {
  return `StaticMeshActor StepSound properties of ${mapLabel(placementAudio?.sourceMap ?? null)}, converted by ${worldAudioConverterStep}; WAV payloads pinned by SHA-256`;
}
