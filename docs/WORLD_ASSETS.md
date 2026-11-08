# Local Talking Island assets

For the separate native Interlude world now integrated at `/?world=interlude`,
see [NATIVE_WORLD.md](NATIVE_WORLD.md). That route uses the pinned native packages
and source startup-location evidence. The legacy dataset described here remains
the default Talking Island route; it does not prove a match to native `20_20`.

The client uses the existing audited Unity-reference terrain, scenery and surface outputs from `C:/laragon/www/lineagen`. Staging copies verified files without running converters, rebaking geometry, changing source workspaces, or applying additional placement transforms. The character asset pipeline remains separate.

The 2026-11-05 conversion review rechecked the existing flicker fixes: GPU
camera-relative rendering and visibility policy remain runtime responsibilities;
four exact foliage materials still need their scoped cutout correction. The
pinned opaque-RGB terrain masks and recovered interior brushes already contain
their earlier conversion repairs. No reviewed evidence warrants moving or
rebaking the whole island. Findings and current hashes are in
`artifacts/native-parity/research/world-conversion-review/{README.md,audit.json}`.
This Unity-reference island remains separate from the native Interlude `20_20`
section described in [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md).

Run from this project:

```sh
pnpm world:stage
pnpm world:verify
```

An alternate **Lineagen workspace root**, containing `.assets/talking-island`, may be supplied as the first argument. The script reads the pinned run directories below; later changes to the source `current.json` pointers do not silently change this client's dataset. A missing or changed pinned file stops staging with an error. `--verify` checks the staged copy without requiring the source workspace or writing files.

The initial staging verified **434 files, 218,583,183 bytes**, against the source hashes and reread destination bytes. These binaries live in ignored `public/assets/world/`. Keep binaries and builds containing them local; staging retains the source's unverified rights status and does not grant redistribution permission.

## Runtime URLs and provenance

`/assets/world/manifest.json` is the local entry and inventory. It is written after every pinned file is staged and verified, and records source paths, sizes, SHA-256 hashes, bundle URLs, source versions and required runtime policies. Original source manifests are copied byte-for-byte under the following URLs:

| URL | Content |
| --- | --- |
| `/assets/world/terrain.glb` | Combined four-tile geometry-only terrain |
| `/assets/world/terrain-manifest.json` | Original terrain metadata, archive hash and rights status |
| `/assets/world/world-models/manifest.json` | Original scenery `instances.json`; 396 model variants, including 133 recovered brushes |
| `/assets/world/world-models/<file>` | All 396 GLBs and five compact grass placement JSONs listed in the scenery manifest |
| `/assets/world/surfaces/manifest.json` | Original source-layer surface metadata |
| `/assets/world/surfaces/<file>` | Original diffuse layers, nine opaque RGB masks and baked fallbacks |
| `/assets/world/locations/manifest.json` | Original coordinate-backed location catalog |
| `/assets/world/locations/<file>` | Coordinate proof, editor starts and source NPC-definition reference data |

Location and NPC reference files are provenance, not server state. In particular, `TalkingIsland` at `[4629.8057, -66.2, 1606.4105]` is a source music-region origin; runtime support queries must resolve a usable character location. It is not a verified gameplay respawn.

| Pinned content | SHA-256 |
| --- | --- |
| Terrain GLB | `9deb41bc2e7d5e0289bfed51fe45d6ac850eb5c8c153600e44fb687bb9ee5920` |
| Terrain manifest | `3f43ee1444deebc823273abfa845b9135b9ac7faea00530bc7209690415f5421` |
| Scenery `20261103T113334577064Z-brushes/instances.json` | `cfdb7b561b26ee9ea72612778a3ded183fd36ea8ac333141cff9b7e76e3bda6f` |
| Surfaces `20261103T111823Z-runtime/manifest.json` | `0258a92e316692473f9e78893885959c3fe4622a5be8db9a5e48cf461cd82c4a` |
| Location manifest | `1d284ac39658ce6cbc7558f9ea5051851bb5514e9ebaa52af913c343b2fbb7ce` |

Scenery, surfaces and locations identify Unity-reference commit `feeee654b2804b11fe7df871d912251cf65d6210`. The original terrain manifest explicitly labels its version `unverified-unity-reference`; the local inventory preserves that label separately instead of silently assigning the scenery commit. Its retained archive hash is `9ba3a11f19bc7540abff05d47742250b93b58d608a0563e6dff7c258f1474e28`.

## Required rendering and movement policies

The staged assets intentionally retain the original material records. Four leaf materials require the narrowly scoped runtime cutout correction before instancing/material readiness caching:

| Model / unchanged GLB SHA-256 | Material names |
| --- | --- |
| `spLand_Legend_tree01_ac6c9d508f` / `6e83aed096e31b779a2cf6de6bf4fcb4ece308e6f3aa7feabdb2c22826660aaa` | `7d1ae4ee8cf6fff4b8acc31af6908918`, `7b7694b6e3e52994e8f29303ac522434`, `71919eff66d9ffa45b846db6f9f9c5e3` |
| `splandddztree1_4ad8c30e4b` / `f37a253110fdd229493819e54c44420c9afcf80399e98810f79524f76cceb043` | `e41a83c8f74b7854da4f2af0542a790a` |

Apply alpha testing (`MASK`), cutoff `0.5`, alpha from the albedo texture and two-sided lighting/culling to those exact materials only. This remains an explicit approximation because the original shader has not been recovered. Geometry, textures and bark remain unchanged. No blanket blend mode or depth bias is appropriate.

The geometry-only terrain has no UV0. Its runtime surface loader must reconstruct source UVs and retain source texture transforms, mask rotation, sRGB decoding before mask interpolation, GPU blend checks and an explicit baked fallback. The pinned surface bundle is `source-layers-v2`; all nine packed masks are RGB PNGs. Per-tile sampler counts are 12, 13, 1 and 13.

The client enables camera-relative rendering, corner-complete model bounds, visibility hysteresis, signed/mirrored placement handling, separate interior floors, and placement-specific collider exclusions. Models categorized as `prop` remain eligible for loading. Two exact flag placements retain their source-disabled colliders; the third remains collidable. Hidden scenery retains collision independently of rendering visibility.

The default page loads the island when its entry manifest is present. `/?world=courtyard` retains the authored environment and original controls. Initial terrain and nearby collision geometry finish loading before the attached Editor script starts the runtime. Corrupt entry manifests or geometry fail visibly; source-layer material failures explicitly select the retained baked surface and record their reason in diagnostics. Streamed assets are SHA-256 checked against the pinned manifest. This dataset provides local visual/support geometry, not multiplayer-authoritative collision or networking.

Navigation uses indexed source triangles, a finite footprint and swept capsule. Radius `0.1`, height `0.9`, step limit `0.3` and slope limit 45° are source-world policies. Supported spawns search near the town anchor and resolve terrain/interior floors without placing actors at the elevated music-marker height. Direct click movement stops at walls, low ceilings, missing support or unloaded collision geometry; automatic routing around obstacles and falling/jumping are not implemented. A spatial index limits collision-readiness queries to nearby placements. This is a supported walking demo, not a claim that every source floor is correct.

All six initial entities, fallback and disposal remain intact. The Human players now load the staged native Interlude player profiles at native scale (exporter 0.01 + actor DrawScale; no height fitting). The earlier per-variant Unity scale recovery (`legacyWorldScale.ts`: about `0.476477` MFighter, `0.464421` FFighter, `0.445751` MMagic, `0.429010` FMagic) was removed together with the lineagen GLBs. This whole Talking Island route is a lineagen-derived local reference that `pnpm build` never ships. World coordinates, buildings and GLB binaries are unchanged. Grounding is reapplied after interpolation. The camera follows Elyra with a 1–50 source-unit zoom range; source units are not labeled as physical meters.

The surface, grass, visibility, foliage and collider-policy modules under `src/scene/world/` adapt the audited local `lineagen/terrain-previews/` implementations. New destination loading/staging code makes those policies available without source preview UI, networking, services or converter execution. The source workspace was read only. Original shader fidelity remains explicitly limited, so no speculative converter rewrite was performed.

The initial 160-unit scenery range is prepared before rendering starts. A CPU
profile showed that software-GPU frames could starve incremental asset loading
when only the smaller collision range was prepared. The visual range and assets
are unchanged. Synthetic spawn/teleport choices avoid positions within 1.4
source units of existing entities; this keeps the demonstration cast separated
without introducing native actor-collision claims.

## Destination validation

`tests/browser/world.spec.ts` requires staged assets and exercises actual island entry, three loaded player GLBs, six initial entities, supported teleport/spawn, click movement, an eight-frame camera orbit, compact touch controls, unstaged fallback and corrupt-receipt failure. Original courtyard/character regression tests explicitly select `?world=courtyard`. Focused unit tests cover collision/support, narrow gaps, steps/ceilings, hidden walls, mirrored floors, missing colliders, spatial lookup equivalence, foliage matching and hysteresis. Final command results are recorded in [VERIFICATION.md](VERIFICATION.md).

Local screenshots and machine-readable reports are under ignored `artifacts/world-integration/`. The initial successful desktop run used Chromium SwiftShader at 1440 × 900: all four tiles used source layers, all **38 GPU blend probes had zero channel error**, both collider exclusions applied, and all eight orbit frames retained **554 visible placements** with no additional visibility transitions or browser errors. Only one of the two foliage variants was nearby, so its single repaired material was exercised by this capture; unit tests cover all four exact material targets. These sampled frames do not prove the absence of every temporal rendering defect.

## Remaining evidence limits

The source audit is [world-conversion-audit.md](../.assets/world-screenshots/20261104-090847/world-conversion-audit.md). It does not prove complete island fidelity. Remaining gaps include the matching `17_24` static prefab, an excluded forest material mismatch, entrance/waterfall dependencies, 18 unresolved brushes, water, wind, particles, original shaders, lightmaps and some authored normals. No broad reconversion was justified by that evidence or performed by this staging tool.

File-integrity verification does not establish temporal rendering stability. Moving-camera verification belongs to the destination runtime checks, and physical iPhone verification remains necessary for the reported phone-specific blinking. Phase 2 networking is unchanged.
