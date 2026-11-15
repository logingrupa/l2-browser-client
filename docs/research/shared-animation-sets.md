# Shared animation sets

Research only, 2026-11-14. Nothing is built. It becomes a fact when a plan ships it with tests.

## Problem, measured

- Each actor archive embeds the full tracks of its UE2 `MeshAnimation` in `model.glb`. In the actors store, 5.77 GiB of 13.94 GiB of glb is animation binary and 7.33 GiB is glb JSON, most of which is animation accessors and channels. Distinct animation binary: 0.16 GiB, 390 sets.
- Sample of 800 archives, 705 animated, 138 sets (`C:\laragon\l2b-orchestration\pipeline-speed\measure_shared_animation_download_sizes.py`, result `results\shared-animation-download-sizes.json`):
  - archives now 4,215 MiB, the same archives without animation 837 MiB, distinct set tracks 103 MiB;
  - keyed by (set, clip, animation bone index, path), **0 of 365,820 tracks differ between models**. Keyed by node name, 498 differ, all in the `Bip01_L_Finger01` duplicate of `Fighter.MFighter_anim`;
  - in every set, mesh joint 0 maps to the same animation bone, so the root conjugation is a property of the set.
- Example: `Fighter.MFighter_anim` sits in 61 sampled archives at 6.62 MiB each, and 0.89 MiB without animation.
- Browser today (`src/assets/native/NativeActor.ts:80-98`): every entity re-fetches and re-parses its archive with `LoadAssetContainerAsync`, and the dev server sends `Cache-Control: no-store` for content-addressed `/l2/<sha>/` files (`vite/nativeStoreRootPlugin.ts:253`). Ten monsters of one kind cost ten downloads and ten parses.

## Converter facts this relies on

- The set is the mesh's serialized `Animation` reference, from the mesh's own package (`scripts/native_assets.py:438-440`).
- `add_animations` maps mesh joints to animation bones by name and mapped parent, with one index fix for the Fighter duplicate (`scripts/native_assets_lib/animation.py:43-76`). Key values do not depend on the mesh: no per-model rescale, and the mesh origin goes in a parent node (`native_assets.py:738-770`).
- The mapping is already stored per part in `animation-source.json` as `boneMapping` `{meshIndex, animationIndex}` (`native_assets.py:594-621`).
- Assemblies (body, face, hair) and equipment replacements each carry another full copy of the same clips (`gltf.py:196-217`, `NativeActor.ts:265`).

## Babylon.js 9.27.1 options

| Option | What it does | Fit |
|---|---|---|
| `AnimationGroup.clone(name, targetConverter)` or `new AnimationGroup` plus `addTargetedAnimation(animation, node)` | New group with new targets; `cloneAnimations` defaults to false, so `Animation` objects and their keys are shared | Use. Same skeleton, same keys, no copy |
| `AnimatorAvatar.retargetAnimationGroup` (v9.0+) | Name-based retarget that rewrites keys for rest-pose and proportion differences | Do not use. Rewriting keys changes native values; source keys already apply as-is |
| `ImportAnimationsAsync` | Imports animations into the scene and binds by node name | Do not use. Name binding breaks on the Finger01 duplicate and on several parts sharing bone names |
| `AssetContainer.instantiateModelsToScene` | Per-entity clone of one loaded container; animation groups are cloned with shared keys (`assetContainer.js:1052`) | Use for per-entity model reuse |
| Baked vertex animation textures | GPU-side playback for crowds | Later, only if many identical actors measure slow on the GTX 1060 |

## Recommended design

1. **Animation set package.** One content-addressed `asset.l2asset` per `MeshAnimation`, kind `animation-set`. Its glb holds:
   - nodes: the animation bones in source order, with `extras.animationBoneIndex`;
   - no meshes and no skins;
   - one animation per sequence, one channel per animated bone and path, with today's coordinate transform and the root conjugation;
   - clip `extras` (`nativeFrames`, `nativeRate`, `nativeDurationSeconds`), plus the set's `animationEvents` in `asset.json`.
   It stays glTF so the existing package reader, the validator and the glTF loader all apply.
2. **Actor archive.** `model.glb` without animations. `asset.json` gains `animationSet` with the set archive SHA-256 and, per skin, the `boneMapping` that `animation-source.json` already holds. Integrity is unchanged, because the reference is a hash.
3. **Browser loader.**
   - An animation set library: `Map<archiveSha256, Promise<LoadedAnimationSet>>`, loaded once with `LoadAssetContainerAsync` (`animationStartMode: NONE`), never added to the scene.
   - Per actor and per skin part, one `AnimationGroup` per clip: `addTargetedAnimation(sharedAnimation, jointNodes[meshIndex])` for each mapping pair. Binding by index, not by name.
   - `nativeClipPlayback.ts` keeps working unchanged, because it already samples `targetedAnimations`. The replacement-part rule "same clip names and durations" becomes "same set SHA-256".
4. **Model reuse.** Cache one `AssetContainer` per archive SHA-256 and give each entity `instantiateModelsToScene`. Dispose the container when its last entity is gone.
5. **HTTP caching.** `/l2/<sha256>/...` is content-addressed and hash-checked, so send `Cache-Control: public, max-age=31536000, immutable` instead of `no-store`.

Steps 4 and 5 need no format change and can ship first.

## Expected effect

- Sample download, every model once: 4,215 MiB now against about 940 MiB plus set JSON.
- Ten different Fighter-based models: about 66 MiB now against about 9 MiB plus one set of about 3 to 6 MiB, downloaded and parsed once.
- Ten entities of one monster: one download and one parse instead of ten (step 4).
- The store shrinks by the same ratio for the actors area, and each set's keys exist once in browser memory.

## Fidelity

Sharing changes no value: the set file holds the same key bytes, applied to the same joints through the converter's own mapping. The test is a round trip: put a slim model and its set back together, and every track must equal the original glb byte for byte.

## Migration that keeps "extract once"

- Change the converter to write the new form and raise the converter version.
- A one-time migration splits the sealed archives already in the store into slim archive plus set, re-seals them, and is deleted after it runs. It reads no client source and runs no UModel.
- It may re-seal only after a sample of freshly converted units equals the migrated bytes.
- It writes the main store, so only the integration thread runs it.

Invalidated by the change: archive and model hashes in the catalog, `animation_audio_bundle.py` pins, the alias report, the pinned glb hashes in `src/assets/native/nativeHumanHandAnchor.ts:16-21`, and the clip checks in `NativeActor.ts:87-93,265`.

## Tests to add

- Python: set package build, round-trip byte equality, migration equals fresh conversion, a refusal when the root bone differs.
- Vitest: index binding over several parts, keys shared and not copied, one fetch per set and per archive, refcounted dispose.
- Playwright: an assembled character and two NPCs of one set play the same frames as today.

## Open points

- No REA question is needed: the binding is already decided from native data by the converter, and the measurement proves it holds across models. Ask REA only if a future set is found applied to a mesh from another package (today a gap, `scripts/actors/npc_requests.py:47-53`).
- Production hosting headers are not known yet.
- The set JSON size depends on accessor layout; measure it on the first built set.

## Sources

- [Babylon.js animation retargeting](https://doc.babylonjs.com/features/featuresDeepDive/animation/animationRetargeting), [AnimatorAvatar](https://doc.babylonjs.com/typedoc/classes/_babylonjs_core.AnimatorAvatar), and local typings `node_modules/@babylonjs/core/Animations/animationGroup.pure.d.ts:388`.
- Forum: [separate animation glTF](https://forum.babylonjs.com/t/gltf-separate-animiation-from-model-no-targeted-animations/61628), [slow glTF animation parsing](https://forum.babylonjs.com/t/importing-parsing-animations-from-gltf-takes-too-long/54134), [animations-only files](https://forum.babylonjs.com/t/attaching-gltf-glb-animations-only-files-to-gltf-glb-3d-models/30729).
