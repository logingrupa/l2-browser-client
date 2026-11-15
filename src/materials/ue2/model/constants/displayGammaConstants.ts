import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";
import { materialNotes } from "./materialNotes";

export const DISPLAY_GAMMA_CONSTANTS = {
  ramp: {
    id: "gamma.ramp",
    value: "out = clamp(appRound(f32((C + 0.5) * pow(x, 1 / G) * 65535 + (B - 0.5) * 32768 - C * 32768 + 16384)), 0, 65535) / 65535 over a 256-entry table with G, B and C as float32; at G = 0 pow(x < 1, +inf) = 0 and pow(1, +inf) = 1",
    provenance: "D3DDrv.dll 05622dde UD3DRenderDevice::UpdateGamma 0x100182C0 (POL-04 re-derivation): 256 red, green and blue WORD entries, then SetDeviceGammaRamp; Brightness, Contrast and Gamma are the UClient config floats at +0x7C, +0x80 and +0x84 (Engine.dll 4dd2f63c property registration near 0x10542AC0, read by UClient::Init 0x10542590 with no clamp); Core.dll 9462f87a appRound 0x1012D890 = trunc(floor(F + 0.5)), appPow 0x1012D7A0 into the CRT pow whose special values at 0x101884A4 give pow(1, +inf) = 1",
    status: "corrected-interlude",
    interludeEvidence: "D3DDrv.dll 05622dde UD3DRenderDevice::UpdateGamma 0x100182C0",
    runtimeDefault: "out = clamp(appRound(f32((C + 0.5) * pow(x, 1 / G) * 65535 + (B - 0.5) * 32768 - C * 32768 + 16384)), 0, 65535) / 65535 over a 256-entry table with G, B and C as float32; at G = 0 pow(x < 1, +inf) = 0 and pow(1, +inf) = 1",
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
