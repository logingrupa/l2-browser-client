import type { ReferenceConstantRow } from "../../../../shared/referenceConstant";
import type { BlendFactorPair } from "./blendFactorTypes";

const terrainLayerAnswer = "Q11 replay-verified terrain-layer-mapping.json db178565...86bd (Engine.dll, D3DDrv.dll, Core.dll lock-equal, 3,948 instructions)";
const basePassPair: BlendFactorPair = { source: "one", destination: "zero" };
const layerPassPair: BlendFactorPair = { source: "source-alpha", destination: "inverse-source-alpha" };

export const TERRAIN_LAYER_CONSTANTS = {
  passOrder: {
    id: "terrain.pass-order",
    value: "one material pass per kept layer (Texture and AlphaMap both set) in increasing layer index; the first kept layer is the base",
    provenance: `${terrainLayerAnswer}: GenerateTriangles render method 2, one group per kept layer`,
    status: "confirmed-interlude",
    interludeEvidence: "Engine.dll GenerateTriangles render method 2",
    runtimeDefault: "increasing layer index, first kept layer is the base",
  },
  basePassBlend: {
    id: "terrain.base-pass-blend",
    value: basePassPair,
    provenance: `${terrainLayerAnswer}: first pass src ONE, dst ZERO, no alpha blend, no alpha test`,
    status: "confirmed-interlude",
    interludeEvidence: "D3DDrv.dll SetTerrainMaterial",
    runtimeDefault: basePassPair,
  },
  layerPassBlend: {
    id: "terrain.layer-pass-blend",
    value: layerPassPair,
    provenance: `${terrainLayerAnswer}: later passes src SRCALPHA, dst INVSRCALPHA, alpha blend on, alpha test GREATER 0, C = Ci * Ai + Cold * (1 - Ai), weights not normalised`,
    status: "confirmed-interlude",
    interludeEvidence: "D3DDrv.dll SetTerrainMaterial",
    runtimeDefault: layerPassPair,
  },
  blendOperation: {
    id: "terrain.blend-operation",
    value: "add",
    provenance: `assumption: ${terrainLayerAnswer} finds no D3DRS_BLENDOP write on the terrain path, so the state is inherited; ADD is the Direct3D default and is assumed here`,
    status: "unconfirmed",
    interludeEvidence: null,
    runtimeDefault: "add",
  },
  layerUv: {
    id: "terrain.layer-uv",
    value: "u = P.x / (TerrainScale.x * UScale) - UPan, v = P.y / (TerrainScale.y * VScale) - VPan for TextureMapAxis 0 without rotation; the serialized TerrainMatrix holds it",
    provenance: `${terrainLayerAnswer}: CalcLayerTexCoords 0x1071c920; layers with another axis, a rotation or a pan keep terrain-layer-uv-unverified`,
    status: "confirmed-interlude",
    interludeEvidence: "Engine.dll CalcLayerTexCoords 0x1071c920",
    runtimeDefault: "serialized TerrainMatrix columns 0 and 1",
  },
} as const satisfies Record<string, ReferenceConstantRow<unknown>>;
