import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";
import { materialNotes } from "./materialNotes";

export const COMBINER_CONSTANTS = {
  maskChannel: {
    id: "combiner.mask-channel",
    value: "green",
    provenance: `${materialNotes} combiner.mask-channel: green in lineage2js/src/materials/mesh-static-material/shader/shader-mesh-static.fs:653-660`,
    status: "unknown",
    interludeEvidence: null,
    runtimeDefault: "green",
  },
  resultClamp: {
    id: "combiner.result-clamp",
    value: [0, 1],
    provenance: `${materialNotes} Combiner operations: clamp each result to [0, 1], an unconfirmed fixed-function assumption`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: [0, 1],
  },
  maskNamedOperations: {
    id: "combiner.mask-named-operations",
    value: { CO_Add_With_Mask_Modulation: "c1 + c2 * m", CO_Use_Color_From_Mask: "mask.rgb" },
    provenance: `${materialNotes} Combiner operations 6 and 7, taken from the operation names; lineage2js falls back to Material1 (un-material.ts:331-350), which is not followed`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: { CO_Add_With_Mask_Modulation: "c1 + c2 * m", CO_Use_Color_From_Mask: "mask.rgb" },
  },
  missingMaskAlpha: {
    id: "combiner.missing-mask-alpha",
    value: 0,
    provenance: `${materialNotes} Combiner operations: AO_Use_Mask with no Mask gives alpha 0, as the flame owner writes for Default_Flame01 (src/scene/world/nativeMaterialGraph.ts); the rule is open`,
    status: "unknown",
    interludeEvidence: null,
    runtimeDefault: 0,
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;

export const COLOUR_CONSTANTS = {
  byteOrder: {
    id: "colour.byte-order",
    value: ["B", "G", "R", "A"],
    provenance: `${materialNotes} colour.byte-order: B, G, R, A in lineage2js/src/assets/unreal/un-color.ts:37-43 and src/scene/world/nativeMaterialGraph.ts, R, G, B, A in scripts/native_sky.py:166; B, G, R, A until the R != B fixture`,
    status: "unknown",
    interludeEvidence: null,
    runtimeDefault: ["B", "G", "R", "A"],
  },
  fadeColourForms: {
    id: "colour.fade-forms",
    value: "q = (t + FadePhase) / FadePeriod; FC_Sinusoidal w = 0.5 + 0.5 * cos(q * pi / 2); FC_Linear w = frac(q) when floor(q) is odd, else 1 - frac(q); colour = Color1 * w + Color2 * (1 - w)",
    provenance: `${materialNotes} Colour sources and animated textures; uv.modifiers; the sinusoid stays byte-equal to evaluateNativeFlameFade (src/scene/world/nativeFlameMaterials.ts)`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "q = (t + FadePhase) / FadePeriod; FC_Sinusoidal w = 0.5 + 0.5 * cos(q * pi / 2); FC_Linear w = frac(q) when floor(q) is odd, else 1 - frac(q); colour = Color1 * w + Color2 * (1 - w)",
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;
