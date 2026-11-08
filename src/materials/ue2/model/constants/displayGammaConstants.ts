import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";
import { materialNotes } from "./materialNotes";

export const DISPLAY_GAMMA_CONSTANTS = {
  ramp: {
    id: "gamma.ramp",
    value: "out = clamp((C + 0.5) * x^(1 / G) + (B - C) * 32768 / 65535, 0, 1) over a 256-entry table; G = 0 turns the ramp off",
    provenance: `${materialNotes} gamma.ramp; lineage2js/src/rendering/display-gamma.ts:7,53-57`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "out = clamp((C + 0.5) * x^(1 / G) + (B - C) * 32768 / 65535, 0, 1) over a 256-entry table; G = 0 turns the ramp off",
  },
  gamma: {
    id: "gamma.setting",
    value: 1.2,
    provenance: `${materialNotes} gamma.setting: client system/Option.ini [Video] Gamma=1.200000, read-only`,
    status: "ue2-data",
    interludeEvidence: null,
    runtimeDefault: 1.2,
  },
  brightnessAndContrast: {
    id: "gamma.brightness-contrast",
    value: { brightness: 0.8, contrast: 0.7 },
    provenance: `${materialNotes} gamma.brightness-contrast: reference defaults Brightness 0.8 and Contrast 0.7 (lineage2js/src/assets/unreal/conf-files/un-conf-system.ts:40-44) until l2.ini and user.ini decode`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: { brightness: 0.8, contrast: 0.7 },
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;
