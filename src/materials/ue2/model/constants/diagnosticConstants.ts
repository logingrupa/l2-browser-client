import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";

export const DIAGNOSTIC_CONSTANTS = {
  magenta: {
    id: "diagnostic.unported-colour",
    value: [1, 0, 1, 1],
    provenance: "docs/OUTPUT_CONTRACT.md and scripts/native_assets.py UNBOUND_SOURCE_SLOT baseColorFactor [1, 0, 1, 1]: an unported or unresolved material renders the named magenta diagnostic (ARCH-03)",
    status: "ue2-data",
    interludeEvidence: null,
    runtimeDefault: [1, 0, 1, 1],
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;
