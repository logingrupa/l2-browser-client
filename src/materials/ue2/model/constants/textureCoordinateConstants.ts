import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";
import { materialNotes, texOscillatorTriggeredReplay } from "./materialNotes";

const oscillatorEvidence = `Engine.dll 4dd2f63c UTexOscillatorTriggered::GetMatrix 0x1030b94c jumps to 0x105e1270, which calls UTexOscillator::GetMatrix 0x1030e98f, body 0x105df780; Engine.u 9b04ff5c; ${texOscillatorTriggeredReplay}`;
const pannerForm = { translation: "1024 * frac(dir * t * PanRate / 1024), dir = (cos(Pitch) cos(Yaw), cos(Pitch) sin(Yaw))", wrapPeriod: 1024 } as const;
const chainOrderEvidence =`D3DDrv.dll 05622dde 0x10011ca0 visits the outer modifier before its Material at +0x578 and accumulates identity (0x10007630) * current.GetMatrix(t) on the CPU path; ${texOscillatorTriggeredReplay}`;

export const TEXTURE_COORDINATE_CONSTANTS = {
  chainOrder: {
    id: "uv.chain-order",
    value: "uv' = M_inner * ... * M_outer * uv",
    provenance: `${materialNotes} UV modifiers: one 3x3 matrix per sampler per frame, the product of its chain; D3DDrv stores M_outer * ... * M_inner in row vectors (ocean-s * ocn_rot), which is this column-vector order; only the CPU path is proven, the GL2Shader route is open (DB-2 child-matrix-order, alternate-render-route)`,
    status: "confirmed-interlude",
    interludeEvidence: chainOrderEvidence,
    runtimeDefault: "uv' = M_inner * ... * M_outer * uv",
  },
  pannerForm: {
    id: "uv.panner",
    value: pannerForm,
    provenance: `RM-5 sky-colours-by-hour.json 8519638b...acb3, claim audit verified-sky-hour-colours.md: UTexPanner::GetMatrix (export thunk 0x10302400, UTexPanner vtable +0xa8) takes dir = FRotator::Vector(PanDirection +0x584) and q = PanRate (+0x590) * time, then du = 1024 * frac(dir.X * q / 1024) and dv = 1024 * frac(dir.Y * q / 1024) (1/1024 at 0x108d2218, 1024 at 0x108d2208, Core appFloor) into M[2][0] and M[2][1] of an identity at +0x594; no other input and no ZoneInfo read. The D3D route 0x10011ca0 passes the main viewport level TimeSeconds, the presentation levelSeconds here`,
    status: "confirmed-interlude",
    interludeEvidence: "Engine.dll 4dd2f63c UTexPanner::GetMatrix 0x105df3e0",
    runtimeDefault: pannerForm,
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
  oscillatorPanForm: {
    id: "uv.oscillator-pan",
    value: "OT_Pan adds o = A * sin(2 * pi * (frac(t * rate) + phase)) to the axis, a translation; the UOffset and VOffset pivot cancels; the serialized M is rebuilt from identity",
    provenance: `${materialNotes} uv.modifiers TexOscillator; DB-2 ocean-formula: ocean-s V is OT_Pan with M[2][1] = A_v * sin(2*pi*(frac(tau*R_v) + P_v)), its U OT_StretchRepeat with amplitude 0 keeps scale 1`,
    status: "confirmed-interlude",
    interludeEvidence: oscillatorEvidence,
    runtimeDefault: "OT_Pan adds o = A * sin(2 * pi * (frac(t * rate) + phase)) to the axis, a translation; the UOffset and VOffset pivot cancels; the serialized M is rebuilt from identity",
  },
  oscillatorForm: {
    id: "uv.oscillator",
    value: "o = A * sin(w * frac(t * rate) + 2 * pi * phase), w = 2 * pi for Stretch, pi / 2 for StretchRepeat; Stretch u' = (u - k) * (1 + o) + k, k = UOffset / USize; Jitter draws A * (2u - 1) per update from tex-jitter",
    provenance: `${materialNotes} uv.modifiers TexOscillator; lineage2js/src/materials/mesh-static-material/shader/shader-mesh-static.vs:407-444 (its constant Jitter is not followed); DB-2 decodes only OT_Pan and a zero-amplitude StretchRepeat, so Stretch, a nonzero StretchRepeat and Jitter stay open`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "o = A * sin(w * frac(t * rate) + 2 * pi * phase), w = 2 * pi for Stretch, pi / 2 for StretchRepeat; Stretch u' = (u - k) * (1 + o) + k, k = UOffset / USize; Jitter draws A * (2u - 1) per update from tex-jitter",
  },
  triggeredOscillatorWindow: {
    id: "uv.triggered-oscillator-window",
    value: "the TexOscillator matrix at tau = TriggeredTime < 0 ? 0 : min(t - TriggeredTime, D), D = StopAfterPeriod / max(UOscillationRate, VOscillationRate), t level seconds",
    provenance: `${materialNotes} TexOscillatorTriggered; DB-2 native-wrapper, time-window and time-source: GetMatrix does not read the Triggered bit, t is LevelInfo.TimeSeconds (D3DDrv 0x10011efe, 0x10011f10); Reverse and GIsEditor are not reachable without a Trigger or the editor`,
    status: "confirmed-interlude",
    interludeEvidence: oscillatorEvidence,
    runtimeDefault: "the TexOscillator matrix at tau = TriggeredTime < 0 ? 0 : min(t - TriggeredTime, D), D = StopAfterPeriod / max(UOscillationRate, VOscillationRate), t level seconds",
  },
  triggeredOscillatorStartState: {
    id: "uv.triggered-oscillator-start-state",
    value: 0,
    provenance: `${materialNotes} TexOscillatorTriggered start state: cold load TriggeredTime 0, Reverse False, Triggered False (DB-2 default-initialization); a level-start MaterialTrigger.PostBeginPlay Reset sets TriggeredTime -1 and holds tau 0; whether any map resets ocean-s is DB-2 map-reset-reachability, unresolved; Trigger (RTA_Retrigger restarts the timed span) is not ported because no server or level trigger reaches the client`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: 0,
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
