import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";
import { combinerStageSemanticsReplay, materialNotes } from "./materialNotes";

const combinerStageEvidence = `D3DDrv.dll 05622dde HandleCombinedMaterial 0x10014400, Mask=None branch 0x10014a24, colour switch 0x1001509a, alpha switch 0x100154b1, CO6 cap test 0x10015466; ${combinerStageSemanticsReplay}`;

const operationForms = {
  CO_Use_Color_From_Material1: "M1.rgb",
  CO_Use_Color_From_Material2: "M2.rgb",
  CO_Multiply: "M1.rgb * M2.rgb * k, k = 4 with Modulate4X, else 2 with Modulate2X, else 1",
  CO_Add: "M1.rgb + M2.rgb",
  CO_Subtract: "M2.rgb - M1.rgb",
  AO_Use_Mask: "the routed mask alpha with a Mask, else F.a",
  AO_Multiply: "M1.a * M2.a",
  AO_Add: "M1.a + M2.a",
  AO_Use_Alpha_From_Material1: "M1.a",
  AO_Use_Alpha_From_Material2: "M2.a",
} as const;

const maskNamedOperations = {
  CO_AlphaBlend_With_Mask: "M2.rgb * m + M1.rgb * (1 - m), m = the routed mask alpha with a Mask, else F.a",
  CO_Add_With_Mask_Modulation: "M2.rgb + M2.a * M1.rgb with D3DTEXOPCAPS_MODULATEALPHA_ADDCOLOR, else M1.rgb + M2.rgb",
  CO_Use_Color_From_Mask: "F.rgb, the builder has no colour case for it",
} as const;

const firstEmittedMaterialRule = "F = Material2 when Material1 resolves to a bitmap and Material2 does not, or when both are bitmaps with InvertMask and a Mask identical to Material2, else Material1";

export const COMBINER_CONSTANTS = {
  maskChannel: {
    id: "combiner.mask-channel",
    value: "alpha",
    provenance: `${materialNotes} Combiner operations: a Mask feeds only alpha arguments, its alpha or 1 - alpha with InvertMask on a bitmap or child-alias Mask, never on a ConstantColor or FadeColor Mask (DB-1 invert-mask); a Mask identical to F passes the complement into F alpha for every operation; the reference green channel (lineage2js shader-mesh-static.fs:653-660) is refuted by DB-1 mask-routing`,
    status: "corrected-interlude",
    interludeEvidence: combinerStageEvidence,
    runtimeDefault: "alpha",
  },
  operationForms: {
    id: "combiner.operation-forms",
    value: operationForms,
    provenance: `${materialNotes} Combiner operations: forms in Material terms, the builder swaps stage arguments itself; DB-1 refutes the reference CO4 M1 - M2 and AO_Use_Mask 0 without a Mask; M1.a and M2.a are stage alphas, complemented for F when the Mask is identical to F with InvertMask; open: InvertMask with a Mask identical to the appended bitmap that cannot be reordered, for AO1-AO4 (DB-1 invert-mask, weak)`,
    status: "corrected-interlude",
    interludeEvidence: combinerStageEvidence,
    runtimeDefault: operationForms,
  },
  maskNamedOperations: {
    id: "combiner.mask-named-operations",
    value: maskNamedOperations,
    provenance: `${materialNotes} Combiner operations 5, 6 and 7; DB-1 refutes the CO5 orientation, CO6 c1 + c2 * m and CO7 mask.rgb taken from the names; Mask=None is accepted with no white or zero mask; CO6 reads the COLORARG1 alpha, M2.a or its complement when Material2 is the complemented F; open: CO6 in the swapped order with a separate Mask (DB-1 colour-6, mask-routing)`,
    status: "corrected-interlude",
    interludeEvidence: combinerStageEvidence,
    runtimeDefault: maskNamedOperations,
  },
  firstEmittedMaterial: {
    id: "combiner.first-emitted-material",
    value: firstEmittedMaterialRule,
    provenance: `${materialNotes} Combiner operations: F is D3DTA_CURRENT, the child the builder emits first; a texture expression of the stage plan is the bitmap case, and two bitmaps swap with InvertMask and a Mask identical to Material2 (DB-1 builder-order)`,
    status: "confirmed-interlude",
    interludeEvidence: combinerStageEvidence,
    runtimeDefault: firstEmittedMaterialRule,
  },
  modulateAlphaAddColourCap: {
    id: "combiner.modulate-alpha-add-colour-cap",
    value: true,
    provenance: `${materialNotes} Combiner operations: CO6 tests D3DTEXOPCAPS_MODULATEALPHA_ADDCOLOR (TextureOpCaps 0x20000) at D3DDrv.dll 05622dde 0x10015466; the D3D9 hardware the client targets reports it, no live device caps are captured (DB-1 live-device-inputs unresolved)`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: true,
  },
  resultClamp: {
    id: "combiner.result-clamp",
    value: [0, 1],
    provenance: `${materialNotes} Combiner operations: clamp each result to [0, 1], an unconfirmed fixed-function assumption; DB-1 gives arithmetic before device range handling and leaves gpu-clamp-and-precision unresolved`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: [0, 1],
  },
  absentMaterial: {
    id: "combiner.absent-material",
    value: "white",
    provenance: `${materialNotes} Combiner operations: c1, a1 come from Material1 and c2, a2 from Material2, white when absent; DB-1 leaves a null Material2 unresolved (arbitrary-tree-coverage)`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "white",
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;

export const COLOUR_CONSTANTS = {
  byteOrder: {
    id: "colour.byte-order",
    value: ["B", "G", "R", "A"],
    provenance: `${materialNotes} colour.byte-order: B, G, R, A in lineage2js/src/assets/unreal/un-color.ts:37-43 and src/scene/world/nativeMaterialGraph.ts, R, G, B, A in scripts/world/sky_step.py:184; B, G, R, A until the R != B fixture`,
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
