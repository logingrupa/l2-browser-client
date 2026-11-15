import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";
import { materialNotes } from "./materialNotes";

export const LIGHTING_CONSTANTS = {
  modulate2x: {
    id: "light.modulate2x",
    value: 2,
    provenance: `${materialNotes} light.modulate2x and recipes/world/lighting-rules.json light-modulate2x: lightmaps, vertex-lit meshes and terrain output c * 2 * L; lineage2js/src/materials/mesh-static-material/mesh-static-material.ts:146,163`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: 2,
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;
