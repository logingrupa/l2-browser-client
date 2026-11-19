import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";
import type { BlendFactor, BlendFactorPair } from "./blendFactorTypes";
import { combinerStageSemanticsReplay, materialNotes, sharedSkyPassesReplay } from "./materialNotes";

const pair = (source: BlendFactor, destination: BlendFactor): BlendFactorPair => ({ source, destination });

export interface NamedBlendPair<Pair extends BlendFactorPair | null = BlendFactorPair | null> {
  readonly name: string;
  readonly pair: Pair;
}

const named = <Pair extends BlendFactorPair | null>(name: string, factors: Pair): NamedBlendPair<Pair> => ({ name, pair: factors });

const finalBlendPairs: readonly NamedBlendPair<BlendFactorPair>[] = [
  named("FB_Overwrite", pair("one", "zero")),
  named("FB_Modulate", pair("destination-colour", "source-colour")),
  named("FB_AlphaBlend", pair("source-alpha", "inverse-source-alpha")),
  named("FB_AlphaModulate_MightNotFogCorrectly", pair("one", "inverse-source-alpha")),
  named("FB_Translucent", pair("one", "inverse-source-colour")),
  named("FB_Darken", pair("zero", "inverse-source-colour")),
  named("FB_Brighten", pair("source-alpha", "one")),
  named("FB_Invisible", pair("zero", "one")),
  named("FB_Add", pair("one", "one")),
];

const outputBlendingReferencePairs: readonly NamedBlendPair[] = [
  named("OB_Normal", pair("one", "zero")),
  named("OB_Masked", pair("one", "zero")),
  named("OB_Modulate", pair("destination-colour", "source-colour")),
  named("OB_Translucent", null),
  named("OB_Invisible", pair("zero", "one")),
  named("OB_Brighten", null),
  named("OB_Darken", pair("zero", "inverse-source-colour")),
];

const outputBlendingInterludePairs: Readonly<Record<number, NamedBlendPair>> = {
  3: named("OB_Translucent", pair("one", "one")),
  5: named("OB_Brighten", pair("one", "inverse-source-colour")),
};

const particleDrawStyleReferencePairs: readonly NamedBlendPair[] = [
  named("PTDS_Regular", pair("one", "zero")),
  named("PTDS_AlphaBlend", pair("source-alpha", "inverse-source-alpha")),
  named("PTDS_Modulated", pair("destination-colour", "source-colour")),
  named("PTDS_Translucent", pair("one", "one")),
  named("PTDS_AlphaModulate", pair("one", "inverse-source-alpha")),
  named("PTDS_Darken", pair("zero", "inverse-source-colour")),
  named("PTDS_Brighten", pair("one", "inverse-source-colour")),
];

export const BLEND_CONSTANTS = {
  finalBlendPairs: {
    id: "blend.fb-pairs",
    value: finalBlendPairs,
    provenance: `${sharedSkyPassesReplay}: the FinalBlend framebuffer branch 0x1000f4e2 of 0x1000f4a0 writes D3DRS_SRCBLEND and D3DRS_DESTBLEND for FrameBufferBlending 0 to 8 as ONE/ZERO, DESTCOLOR/SRCCOLOR, SRCALPHA/INVSRCALPHA, ONE/INVSRCALPHA, ONE/INVSRCCOLOR, ZERO/INVSRCCOLOR, SRCALPHA/ONE, ZERO/ONE and ONE/ONE, so FB_Add is ONE/ONE`,
    status: "confirmed-interlude",
    interludeEvidence: "D3DDrv.dll 05622dde FinalBlend pass builder 0x1000f4a0, branch 0x1000f4e2",
    runtimeDefault: finalBlendPairs,
  },
  enumOrdinals: {
    id: "blend.enum-ordinals",
    value: "FB Overwrite 0 to Add 8; OB Normal 0, Masked 1, Modulate 2, Translucent 3, Invisible 4, Brighten 5, Darken 6; PTDS Regular 0 to Brighten 6; CO 0 to 7; AO 0 to 4",
    provenance: `${materialNotes} blend.enum-ordinals; lineage2js/src/assets/unreal/un-material.ts:215-260,368-379; lineage2js/src/assets/unreal/emitters/un-particle-emitter.ts:871-879; the runtime keys every table by ordinal, the program enum name is kept for display`,
    status: "ue2-data",
    interludeEvidence: null,
    runtimeDefault: "FB Overwrite 0 to Add 8; OB Normal 0, Masked 1, Modulate 2, Translucent 3, Invisible 4, Brighten 5, Darken 6; PTDS Regular 0 to Brighten 6; CO 0 to 7; AO 0 to 4",
  },
  outputBlendingPairs: {
    id: "blend.ob-pairs",
    value: outputBlendingReferencePairs,
    provenance: `${materialNotes} blend.ob-pairs; lineage2js/src/assets/unreal/un-material.ts:508-517; OB_Normal with an Opacity input blends source-alpha, inverse-source-alpha`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: outputBlendingReferencePairs,
  },
  outputBlendingInterludePairs: {
    id: "blend.ob-brighten-translucent",
    value: outputBlendingInterludePairs,
    provenance: "docs/NATIVE_FLAMES.md:9 recovered flame factors ONE / ONE_MINUS_SRC_COLOR (OB_Brighten) and glow ONE / ONE (OB_Translucent) for FX_E_S.Flameset.Default_Flame01; matches lineage2js/src/assets/unreal/un-material.ts:508-517",
    status: "confirmed-interlude",
    interludeEvidence: "docs/NATIVE_FLAMES.md:9",
    runtimeDefault: outputBlendingInterludePairs,
  },
  normalWithOpacityPair: {
    id: "blend.ob-normal-opacity",
    value: pair("source-alpha", "inverse-source-alpha"),
    provenance: `${materialNotes} Blend table row 0: OB_Normal is ONE, ZERO, or SRCALPHA, INVSRCALPHA with Opacity; DB-1 shader-opacity-and-output also gives blend on, ZWrite off and the final alpha Opacity.a for that case`,
    status: "confirmed-interlude",
    interludeEvidence: `D3DDrv.dll 05622dde Shader pass builder FUN_1000ae10, OutputBlending and Opacity test 0x1000c7f7; ${combinerStageSemanticsReplay}`,
    runtimeDefault: pair("source-alpha", "inverse-source-alpha"),
  },
  particleDrawStylePairs: {
    id: "blend.ptds-pairs",
    value: particleDrawStyleReferencePairs,
    provenance: "IMPORTA-PC RM-2 report rea-in/20261113-roadmap/power-strike-caster-burst.json, replayed 704 of 704 instructions: the D3DDrv pass setup switches on material+0x578 and DrawStyle 3 PTDS_Translucent writes source ONE, destination ONE, DrawStyle 6 PTDS_Brighten source ONE, destination INVSRCCOLOR; the pass is committed as D3DRS_SRCBLEND 19 and D3DRS_DESTBLEND 20; the emitter field identities +0x344 DrawStyle and +0x4d4 bit 0 UseMeshBlendMode are asserted by the report, not derived (RM-8 open)",
    status: "confirmed-interlude",
    interludeEvidence: "D3DDrv.dll 05622dde 0x100273d0 -> 0x10027acb (src 2, dst 2 for DrawStyle 3; src 2, dst 4 for DrawStyle 6), SetRenderState 0x13/0x14 at 0x1002ef48/0x1002ef6f; emitter +0x344 and +0x4d4 field identities asserted, not derived (RM-8 open)",
    runtimeDefault: particleDrawStyleReferencePairs,
  },
  particleAlphaPair: {
    id: "blend.ptds-alpha",
    value: pair("zero", "one"),
    provenance: `${materialNotes} Blend table: particle modes keep destination alpha with ZERO, ONE on alpha`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: pair("zero", "one"),
  },
  maskedAlphaReference: {
    id: "blend.alpha-test",
    value: 127,
    provenance: `${materialNotes} blend.alpha-test: OB_Masked and bMasked test at 127/255 with depth write, discard when alpha < reference; lineage2js/src/materials/mesh-static-material/mesh-static-material.ts:315-320`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: 127,
  },
  nonBlendingRoot: {
    id: "blend.non-blending-root",
    value: null,
    provenance: `${materialNotes} Material graph walk: only FinalBlend, Shader and a bare Texture root name a blend; a Combiner, colour source or modifier root without either has no stated pair, so the runtime draws it opaque like a bare Texture until a swatch decides`,
    status: "unknown",
    interludeEvidence: null,
    runtimeDefault: pair("one", "zero"),
  },
  bareTexturePairs: {
    id: "blend.bare-texture",
    value: { opaque: pair("one", "zero"), alphaTexture: pair("source-alpha", "inverse-source-alpha") },
    provenance: `${materialNotes} blend.bare-texture: a bare Texture root draws opaque, bMasked alpha-tests, bAlphaTexture blends SRCALPHA, INVSRCALPHA; lineage2js/src/assets/decoders/material-decoder.ts:596-616`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: { opaque: pair("one", "zero"), alphaTexture: pair("source-alpha", "inverse-source-alpha") },
  },
  depthWriteRule: {
    id: "blend.depth-write",
    value: "depth write only for FB_Overwrite, OB_Normal without Opacity and OB_Masked; a FinalBlend ZWrite overrides",
    provenance: `${materialNotes} Blend table: modes other than Overwrite, Normal without Opacity and Masked turn depth write off, then a FinalBlend ZWrite overrides`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "depth write only for FB_Overwrite, OB_Normal without Opacity and OB_Masked; a FinalBlend ZWrite overrides",
  },
  sharedSkyBackFaceCulling: {
    id: "blend.shared-sky-back-face-culling",
    value: false,
    provenance: "RM-22 shared-sky-nodes.json 5275acf9...0fd4: the sky node walk 0x10689fd0 drops a back-facing node unless its flags hold 0x4000100 or 0x80000, and every accepted node is drawn; RM-21 shared-sky-render-passes pixels20_21.json: the final haze run (draws 645-678) holds 25 back-facing two-sided haze nodes and moves (720,5) from 175,155,129 to 168,150,125, so native rasterises them",
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: false,
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;
