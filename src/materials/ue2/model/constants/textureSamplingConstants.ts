import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";

const textureSamplersReport = "RM-25 texture-samplers.json fc0169fe76524dd3a118474b9211e1b55b182870be3ddf9274d38431d619c1a5 (manifest 96c23b85), claim audit verified-texture-samplers.md, fixtures tests/fixtures/rm25/texture-samplers-native.json";

export type NativeTextureFilter = "linear";
export type NativeTextureAddress = "wrap" | "clamp";

export const TEXTURE_SAMPLING_CONSTANTS = {
  mipBias: {
    id: "texture.default-mip-bias",
    value: -0.5,
    provenance: `l2.ini [D3DDrv.D3DRenderDevice] DefaultTexMipBias=-0.5; ${textureSamplersReport}: the ordinary pass binder 0x10022ef0/0x1000f310 and the programmable setup 0x10038530 send the float bits as D3DSAMP_MIPMAPLODBIAS and all 7 live bound stages read -0.5; the truncating helpers 0x100346a0, 0x1002e140 and 0x10039450 serve no ported draw; the port passes it as the texture2D bias argument (WGSL textureSampleBias); Detail stages take DetailTexMipBias 0.8 once Detail is ported`,
    status: "confirmed-interlude",
    interludeEvidence: textureSamplersReport,
    runtimeDefault: -0.5,
  },
  anisotropy: {
    id: "texture.anisotropy-level",
    value: 1,
    provenance: `l2.ini [D3DDrv.D3DRenderDevice] LevelOfAnisotropy=1; ${textureSamplersReport}: every live bound stage reads D3DSAMP_MAXANISOTROPY 1`,
    status: "confirmed-interlude",
    interludeEvidence: textureSamplersReport,
    runtimeDefault: 1,
  },
  filter: {
    id: "texture.min-mag-mip-filter",
    value: "linear" as NativeTextureFilter,
    provenance: `Option.ini [Video] UseTrilinear=True read into GL2UseTrilinear 1; ${textureSamplersReport}: every live bound stage reads D3DSAMP_MINFILTER, MAGFILTER and MIPFILTER 2 (D3DTEXF_LINEAR) with MAXMIPLEVEL 0`,
    status: "confirmed-interlude",
    interludeEvidence: textureSamplersReport,
    runtimeDefault: "linear" as NativeTextureFilter,
  },
  lightmapAddress: {
    id: "texture.lightmap-address",
    value: "clamp" as NativeTextureAddress,
    provenance: `${textureSamplersReport}: the live wall lightmap stage (FStaticLightMapTexture) reads D3DSAMP_ADDRESSU, V and W 3 (D3DTADDRESS_CLAMP, clamp to edge; BORDERCOLOR 0 unused)`,
    status: "confirmed-interlude",
    interludeEvidence: textureSamplersReport,
    runtimeDefault: "clamp" as NativeTextureAddress,
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;
