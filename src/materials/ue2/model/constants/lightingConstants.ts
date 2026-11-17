import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";

const textureOperationHeader = "d3d9types.h D3DTEXTUREOP";
const hourlyLightingReport = "DB-7 hourly-lighting-composition.json f0a6eb0f, claim audit verified-hourly-lighting.md";

export const LIGHTING_CONSTANTS = {
  lightmapModulateScale: {
    id: "light.lightmap-modulate-scale",
    value: 1,
    provenance: `${textureOperationHeader} D3DTOP_MODULATE (4) multiplies the two arguments; ${hourlyLightingReport} claim bsp-compressed-choice: EnableLighting argument 3 is 0 for UColorModifier materials, so the append-lightmap helper 0x1000f090 writes D3DTOP_MODULATE`,
    status: "confirmed-interlude",
    interludeEvidence: `${hourlyLightingReport}; D3DDrv.dll 05622dde 0x1000f090`,
    runtimeDefault: 1,
  },
  lightmapModulate2xScale: {
    id: "light.lightmap-modulate2x-scale",
    value: 2,
    provenance: `${textureOperationHeader} D3DTOP_MODULATE2X (5) multiplies the two arguments and shifts left by one bit; ${hourlyLightingReport} claim d3d-modulation: the image-initialized global modulation opcode at D3DDrv.dll 0x1011c578 is 5, and a vendor 0x121a device writes 4, so the live opcode is d3d-device-live-state`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: 2,
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;
