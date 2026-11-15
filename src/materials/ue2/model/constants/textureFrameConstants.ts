import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";
import { materialNotes } from "./materialNotes";

export const TEXTURE_FRAME_CONSTANTS = {
  animationStep: {
    id: "texture.anim-next-step",
    value: "step = 1 / clamp(MaxFrameRate, 0.1, 100); phase = t minus whole cycles; each whole step subtracted advances one frame",
    provenance: `${materialNotes} Colour sources and animated textures: AnimNext; matches the native tick at seams like selectNativeFlameFrame (src/scene/world/nativeFlameMaterials.ts)`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "step = 1 / clamp(MaxFrameRate, 0.1, 100); phase = t minus whole cycles; each whole step subtracted advances one frame",
  },
  frameRateRange: {
    id: "texture.max-frame-rate-range",
    value: [0.1, 100],
    provenance: `${materialNotes} AnimNext: step = 1 / clamp(MaxFrameRate, 0.1, 100)`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: [0.1, 100],
  },
  materialSequenceTiming: {
    id: "texture.material-sequence-timing",
    value: null,
    provenance: `${materialNotes} MaterialSequence has no reference behaviour; its timing comes from a side-by-side. The runtime steps through the entries by their display times and wraps when Loop is set until then`,
    status: "unknown",
    interludeEvidence: null,
    runtimeDefault: "entries in order by display time, wrapping when Loop is set",
  },
  particleTextureClock: {
    id: "texture.particle-clock",
    value: null,
    provenance: `${materialNotes} and .planning/reference/lineage2js/04-particles.md: whether particle texture frames follow the particle age or the emitter clock is open for 02-69; lineage2js particle frames by floor(time / framerate) mod count (particle-material.ts:131-138) are not followed`,
    status: "unknown",
    interludeEvidence: null,
    runtimeDefault: null,
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;
