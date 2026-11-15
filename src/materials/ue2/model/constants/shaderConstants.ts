import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";
import { materialNotes } from "./materialNotes";

export const SHADER_CONSTANTS = {
  detail: {
    id: "mat.detail",
    value: "c * 2 * Detail.rgb at uv * DetailScale",
    provenance: `${materialNotes} mat.detail; lineage2js/src/materials/mesh-static-material/shader/shader-mesh-static.fs:624-630`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "c * 2 * Detail.rgb at uv * DetailScale",
  },
  specular: {
    id: "mat.specular",
    value: "o + SpecularityMask.a * Specular, or o * 2 * Specular with ModulateSpecular2X",
    provenance: `${materialNotes} Fragment order step 6`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "o + SpecularityMask.a * Specular, or o * 2 * Specular with ModulateSpecular2X",
  },
  selfIllumination: {
    id: "mat.self-illumination",
    value: "mix(o, SelfIllumination, SelfIlluminationMask.a) and a = SelfIlluminationMask.a, only without Specular",
    provenance: `${materialNotes} mat.self-illumination; lineage2js/src/materials/mesh-static-material/shader/shader-mesh-static.fs:784-791`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "mix(o, SelfIllumination, SelfIlluminationMask.a) and a = SelfIlluminationMask.a, only without Specular",
  },
  unlitLight: {
    id: "mat.unlit-light",
    value: 1,
    provenance: `${materialNotes} Fragment order step 5: L is 1 when unlit; lighting inputs arrive with MAT-02`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: 1,
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;
