import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";
import type { BlendFactor, BlendFactorPair } from "./blendFactorTypes";
import { materialNotes } from "./materialNotes";

const pair = (source: BlendFactor, destination: BlendFactor): BlendFactorPair => ({ source, destination });

export interface NamedBlendPair {
  readonly name: string;
  readonly pair: BlendFactorPair | null;
}

const named = (name: string, factors: BlendFactorPair | null): NamedBlendPair => ({ name, pair: factors });

const finalBlendPairs: readonly NamedBlendPair[] = [
  named("FB_Overwrite", pair("one", "zero")),
  named("FB_Modulate", pair("destination-colour", "source-colour")),
  named("FB_AlphaBlend", pair("source-alpha", "inverse-source-alpha")),
  named("FB_AlphaModulate_MightNotFogCorrectly", pair("one", "inverse-source-alpha")),
  named("FB_Translucent", pair("one", "inverse-source-colour")),
  named("FB_Darken", pair("zero", "inverse-source-colour")),
  named("FB_Brighten", pair("source-alpha", "one")),
  named("FB_Invisible", pair("zero", "one")),
  named("FB_Add", null),
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

const particleDrawStyleShippedPairs: readonly NamedBlendPair[] = particleDrawStyleReferencePairs.map((reference, drawStyle) =>
  drawStyle === 3 ? named(reference.name, pair("one", "inverse-source-colour"))
    : drawStyle === 6 ? named(reference.name, pair("one", "one")) : reference);

export const BLEND_CONSTANTS = {
  finalBlendPairs: {
    id: "blend.fb-pairs",
    value: finalBlendPairs,
    provenance: `${materialNotes} blend.fb-pairs; lineage2js/src/assets/unreal/un-material.ts:399-412; lineage2js/src/materials/mesh-static-material/mesh-static-material.ts:310-378; FB_Add pair unknown and rendered as material-feature-unported:FrameBufferBlending`,
    status: "unconfirmed",
    interludeEvidence: null,
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
    provenance: `${materialNotes} Blend table row 0: OB_Normal is ONE, ZERO, or SRCALPHA, INVSRCALPHA with Opacity`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: pair("source-alpha", "inverse-source-alpha"),
  },
  particleDrawStylePairs: {
    id: "blend.ptds-pairs",
    value: particleDrawStyleReferencePairs,
    provenance: `${materialNotes} blend.ptds-pairs; lineage2js/src/materials/particle-material/particle-material.ts:145-201; the runtime keeps the shipped src/effects/nativeEffectMaterial.ts:152 mapping, DrawStyle 3 ONE, INVSRCCOLOR and 6 ONE, ONE, until a swatch comparison with L2.exe is recorded in docs/parts/skills-effects/EVIDENCE.md (critic conflict 14)`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: particleDrawStyleShippedPairs,
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
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;
