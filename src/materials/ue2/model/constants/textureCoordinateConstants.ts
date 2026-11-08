import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";
import { materialNotes } from "./materialNotes";

export const TEXTURE_COORDINATE_CONSTANTS = {
  chainOrder: {
    id: "uv.chain-order",
    value: "uv' = M_inner * ... * M_outer * uv",
    provenance: `${materialNotes} UV modifiers: one 3x3 matrix per sampler per frame, the product of its chain, outermost first as in the reference`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "uv' = M_inner * ... * M_outer * uv",
  },
  pannerForm: {
    id: "uv.panner",
    value: "translate by t * PanRate * (cos(Pitch) cos(Yaw), cos(Pitch) sin(Yaw))",
    provenance: `${materialNotes} uv.modifiers: TexPanner translates by t * PanRate * (dir.x, dir.y), dir the PanDirection rotator as a unit vector; lineage2js/src/materials/mesh-static-material/shader/shader-mesh-static.vs:407-444`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "translate by t * PanRate * (cos(Pitch) cos(Yaw), cos(Pitch) sin(Yaw))",
  },
  rotatorComponent: {
    id: "uv.rotator-component",
    value: "Yaw",
    provenance: `${materialNotes} TexRotator: Fixed uses Rotation; which rotator component turns the texture plane is not stated in the notes`,
    status: "unknown",
    interludeEvidence: null,
    runtimeDefault: "Yaw",
  },
  rotatorOscillationUnitsPerTurn: {
    id: "uv.rotator-oscillation-units",
    value: 65535,
    provenance: `${materialNotes} TexRotator Oscillating adds A * sin(2*pi*(frac(t * rate / 65535) + phase)); the notes list the 65535 divisor and the unscaled phase under Do not copy (shader-mesh-static.vs:415-416), so the runtime divides rate and phase by the 65536 units per turn until a swatch decides`,
    status: "unknown",
    interludeEvidence: null,
    runtimeDefault: 65536,
  },
  oscillatorForm: {
    id: "uv.oscillator",
    value: "o = A * sin(w * frac(t * rate) + 2 * pi * phase), w = 2 * pi for Pan and Stretch, pi / 2 for StretchRepeat; Stretch u' = (u - k) * (1 + o) + k, k = UOffset / USize; Jitter draws A * (2u - 1) per update from tex-jitter",
    provenance: `${materialNotes} uv.modifiers TexOscillator; lineage2js/src/materials/mesh-static-material/shader/shader-mesh-static.vs:407-444 (its constant Jitter is not followed)`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "o = A * sin(w * frac(t * rate) + 2 * pi * phase), w = 2 * pi for Pan and Stretch, pi / 2 for StretchRepeat; Stretch u' = (u - k) * (1 + o) + k, k = UOffset / USize; Jitter draws A * (2u - 1) per update from tex-jitter",
  },
  scalerOrder: {
    id: "uv.tex-scaler-order",
    value: "u' = u * UScale + UOffset",
    provenance: `${materialNotes} TexScaler has UScale, VScale, UOffset and VOffset with no reference, so a swatch decides their order`,
    status: "unknown",
    interludeEvidence: null,
    runtimeDefault: "u' = u * UScale + UOffset",
  },
  environmentMap: {
    id: "uv.env-map",
    value: "camera space (View * R).xy * 0.5 + 0.5, world space R.xy * 0.5 + 0.5",
    provenance: `${materialNotes} TexEnvMap; lineage2js/src/materials/mesh-static-material/shader/shader-mesh-static.fs:542-558`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "camera space (View * R).xy * 0.5 + 0.5, world space R.xy * 0.5 + 0.5",
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;
