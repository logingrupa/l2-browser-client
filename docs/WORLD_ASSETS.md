# Lineagen-adapted world modules

This doc is the provenance record for five modules under `src/scene/world/` whose header comments cite it. They serve the legacy Talking Island route only. The native world is in [NATIVE_WORLD.md](NATIVE_WORLD.md); licences overall are in [SOURCE_REUSE.md](SOURCE_REUSE.md). Status and work order live in [.planning/STATE.md](../.planning/STATE.md) and [.planning/ROADMAP.md](../.planning/ROADMAP.md).

## Where the code comes from

Each module adapts an implementation from the audited local `C:/laragon/www/lineagen/terrain-previews/` workspace. The destination adds its own loading and staging code. It brings no source preview UI, networking, services or converter execution. The source workspace is read only.

| Module | What it adapts | Destination behaviour |
| --- | --- | --- |
| `foliageCutout.ts` | The preview's leaf-card repair. | Alpha test (`MASK`), cutoff `0.5`, alpha from the albedo texture and two-sided lighting and culling, applied to four exact leaf materials only, before instancing and material readiness caching. The source materials carry `_AlphaClipThreshold=.5` but omit `_AlphaClip`, and their shader is not recovered, so this is an explicit approximation. Geometry, textures and bark stay unchanged. No blanket blend mode or depth bias. |
| `terrainSurfaces.ts` | The preview's source-layer terrain surfaces. | The geometry-only terrain has no UV0. The loader reconstructs source UVs and keeps source texture transforms, mask rotation, sRGB decoding before mask interpolation, GPU blend checks and an explicit baked fallback. The pinned surface bundle is `source-layers-v2`; all nine packed masks are RGB PNGs. Per-tile sampler counts are 12, 13, 1 and 13. A source-layer failure selects the baked surface and records its reason in diagnostics. Unity water and effect stages are omitted. |
| `grassInstances.ts` | The preview's source-backed grass. | Streams grass as thin instances from the five compact grass placement JSONs in the scenery manifest, keeping source placements, mirroring and sidedness. |
| `worldVisibility.ts` | The preview's visibility policy. | Visibility hysteresis near the streaming boundary and corner-complete model bounds. Babylon still frustum-culls each mesh per frame. |
| `sourceColliderPolicy.ts` | The preview's collider handling. | Narrow recovery of disabled Unity collider components, not a material heuristic. Two exact flag placements keep their source-disabled colliders; the third stays collidable. Unknown or revised placements keep the conservative triangle collider. |

## Data the modules read

`pnpm world:stage` copies verified files from pinned lineagen run directories into ignored `public/assets/world/`, without running converters, rebaking geometry or adding placement transforms. `pnpm world:verify` checks the staged copy without the source workspace and without writing files. An alternate lineagen workspace root containing `.assets/talking-island` may be the first argument. A missing or changed pinned file stops staging with an error. The staged set is **434 files, 218,583,183 bytes**. `pnpm build` never copies `public/assets/world/` into `dist/`.

| Pinned content | SHA-256 |
| --- | --- |
| Terrain GLB | `9deb41bc2e7d5e0289bfed51fe45d6ac850eb5c8c153600e44fb687bb9ee5920` |
| Terrain manifest | `3f43ee1444deebc823273abfa845b9135b9ac7faea00530bc7209690415f5421` |
| Scenery `20261103T113334577064Z-brushes/instances.json` | `cfdb7b561b26ee9ea72612778a3ded183fd36ea8ac333141cff9b7e76e3bda6f` |
| Surfaces `20261103T111823Z-runtime/manifest.json` | `0258a92e316692473f9e78893885959c3fe4622a5be8db9a5e48cf461cd82c4a` |
| Location manifest | `1d284ac39658ce6cbc7558f9ea5051851bb5514e9ebaa52af913c343b2fbb7ce` |

| Model / unchanged GLB SHA-256 | Cutout material names |
| --- | --- |
| `spLand_Legend_tree01_ac6c9d508f` / `6e83aed096e31b779a2cf6de6bf4fcb4ece308e6f3aa7feabdb2c22826660aaa` | `7d1ae4ee8cf6fff4b8acc31af6908918`, `7b7694b6e3e52994e8f29303ac522434`, `71919eff66d9ffa45b846db6f9f9c5e3` |
| `splandddztree1_4ad8c30e4b` / `f37a253110fdd229493819e54c44420c9afcf80399e98810f79524f76cceb043` | `e41a83c8f74b7854da4f2af0542a790a` |

Scenery, surfaces and locations identify Unity-reference commit `feeee654b2804b11fe7df871d912251cf65d6210`. The terrain manifest labels its version `unverified-unity-reference`, with retained archive hash `9ba3a11f19bc7540abff05d47742250b93b58d608a0563e6dff7c258f1474e28`. Location and NPC reference files are provenance, not server state. `TalkingIsland` at `[4629.8057, -66.2, 1606.4105]` is a source music-region origin, not a verified respawn.

The conversion review of these files is in `artifacts/native-parity/research/world-conversion-review/README.md` and `artifacts/native-parity/research/world-conversion-review/audit.json`.

## Licence status

No redistribution licence is known for the lineagen workspace or the `linegen` repository ([SOURCE_REUSE.md](SOURCE_REUSE.md)). Staging keeps the source's unverified rights status and grants no redistribution permission. The staged binaries and any build containing them stay local; `pnpm build` excludes them. No redistribution grant is asserted for the adapted code.

## Open

- DEC-SRC-1 says no copied `linegen` source. These five modules are adapted from lineagen code. The owner needs to review whether they stay, are rewritten independently, or leave with the legacy route.
- The `sourceColliderPolicy.ts` header cites `docs/WEAPONS_SHOP_DOORWAY.md` for evidence and source hashes; that file does not exist in this repo.
- The phone-specific blinking report on this route needs a physical iPhone check.
