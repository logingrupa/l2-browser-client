# Output contract

This doc states what a converter writes and what the browser reads (FOUND-02).
Converters live in `scripts/`; the browser reads the store under `/l2/` only
through `readNativeCatalog`. Decisions: [.planning/PROJECT.md](../.planning/PROJECT.md)
and [PORT_SCOPE.md](PORT_SCOPE.md). Pipeline details:
[ASSET_PIPELINE.md](ASSET_PIPELINE.md).

## Two entry kinds

| Entry kind | What it holds | Limits and checks |
| --- | --- | --- |
| `.l2asset` packages | One converted model, texture or sound: `asset.json`, the primary payload (`model.glb`, `texture.png`, `audio.wav` or `audio.ogg`), `provenance.json` and sidecars | ZIP_STORED only, at most 128 MiB per archive, 96 MiB per payload, 256 entries. `asset.json` lists every other file with its SHA-256, byte length and MIME type; readers refuse unlisted, missing or changed files. `provenance.json` keeps the detailed evidence (request, dependencies with hashes, tool pin, format pins). |
| Hash-pinned JSON manifests | Map sections, movers, NPC and player profiles, animation, combat and world audio, effect components | Each manifest references only hash-addressed files under `/l2/<kind>/<sha>/` and carries the same provenance block. The catalog pins each manifest by SHA-256 and byte length. |

World tiles are not repacked into `.l2asset` packages: a section's geometry,
textures and placements exceed the 128 MiB archive limit, so sections stay
hash-pinned JSON manifests.

## asset.json v2 fields

`scripts/native_assets_lib/asset_manifest.py` builds and validates v2.
`build_asset_manifest` is the only writer; `require_supported_asset_manifest`
is the Python validator and `readAssetPackage` is the browser validator.

| Field | Value | Derived from |
| --- | --- | --- |
| `schemaVersion` | `2` | Constant of the writer |
| `id`, `name` | `interlude:<object>`, `<object>` | Selected export, or the media path for loose audio |
| `kind` | `model`, `texture` or `audio` | Conversion request |
| `source.edition`, `package`, `object`, `sha256` | Source identity | Package bytes read through the reference client guard |
| `source.path` | `{ host, absolutePath }` | `socket.gethostname()` (upper case) and the resolved POSIX path of the primary package |
| `clientBuild.referenceTreeLockSha256` | 64 hex | SHA-256 of `json_bytes` of the parsed `recipes/reference-client-tree.lock.json` |
| `clientBuild.engineDllSha256` | 64 hex | The lock's `system/Engine.dll` record, which must be class `equal` and match the converted root's own `system/Engine.dll` |
| `converterVersion` | 64 hex | `implementation_hash()` over the converter and its libraries |
| `coordinates` | Models only, see below | `asset_coordinates_record(SOURCE_TO_GLTF, 100)` |
| `model`, `image` or `audio` | `{ file, ... }` | Primary payload name; models add `nativeMaterialGraph` and `nativeSkinAdapter` when present |
| `files` | Path, SHA-256, bytes, MIME per payload | Hashes of the written payloads |
| `limitations`, `animationEvents` | Lists | Converter findings and native notify events |

The writer refuses when the reference lock is missing, so no package carries
an invented `clientBuild` or `converterVersion`.

## Units and handedness per route

| Route | Unit | Frame | Recorded as |
| --- | --- | --- | --- |
| Models (`.l2asset` with `model.glb`) | Metre | glTF output is right-handed, Y up (Khronos glTF 2.0) | `coordinates: { unit: "metre", sourceUnitsPerMetre: 100, handedness: "right", upAxis: "Y", sourceToGltf }` |
| Textures | None | None | No `coordinates` field |
| Audio | None | None | No `coordinates` field |

`sourceToGltf` is a 16-number column-major matrix. It maps source X to glTF X,
source Y to glTF Z and source Z to glTF Y, each at 0.01. The source is Z-up
with the opposite handedness, so the upper-left 3x3 determinant is negative;
the writer asserts that before it records `handedness: "right"`.

In v1, the same `unit`, `sourceUnitsPerMetre` and `sourceToGltf` sit inside
`model`, with no handedness or up axis. The browser reader exposes one
normalised `manifest.coordinates` for both versions, and the Python helper
`asset_coordinates(manifest)` does the same for scripts.

## Source preservation

Conversion keeps the source bytes and values (CONV-02). There is no 1.8 m
height normalisation, no ground fitting, no root-drift removal and no weight
normalisation. A repair runs only for a demonstrated defect, and the original
values stay next to the repaired ones. `tests/pipeline/test_source_preservation_contract.py`
fails when a rule below drifts from the code.

| Rule | Value | Where | Enforced by |
| --- | --- | --- | --- |
| UModel pin | build1590, SHA-256 `13502e5a4d8f6b5f32252afebd6360f7302ccfaccf6b8dda65beff0be2d364a0` | `scripts/native_assets.py` `UMODEL_SHA256`; the tool is read from `.assets/native-tools/umodel/` (`UMODEL`, the `--umodel` default) | `Converter.__init__` refuses any other tool bytes; `UmodelPinContractTests` |
| Archive limits | 128 MiB per archive, 96 MiB per payload, 256 entries including `asset.json`, ZIP_STORED only | `scripts/native_assets.py` `MAX_ARCHIVE`, `MAX_PAYLOAD`, `archive_bytes`, `verify_archive` | `ArchiveLimitContractTests`: 255 payloads pass, 256 are refused; a payload or archive at the limit passes, one byte over is refused |
| Magenta diagnostic | Unbound slot named `UNBOUND_SOURCE_SLOT_<index>` with `baseColorFactor` [1, 0, 1, 1] and a `Material slot <index>:` limitation; no texture is guessed | `scripts/native_assets.py` `Converter.materials` | `MagentaSlotContractTests` |
| Normalisation ban | No identifier names height, scale or weight normalisation, ground fitting or root-drift and root-motion removal in `scripts/**/*.py`, `scripts/**/*.mjs` (vendor excluded) or `src/**/*.ts` | Allow-list: `scripts/audit_musveren_weights.py`, which measures UModel's packed-weight renormalisation and applies none | `NormalisationIdentifierBanTests`; the allow-list entry must still suppress a hit |
| Skin-weight attribute | Only three modules reference `WEIGHTS_0` | `scripts/native_assets_lib/weights.py` (`restore_native_weights` restores source float influences), `scripts/native_assets_lib/rigid.py` (`is_root_rigid` reads weights to prove a root-only rigid skin), `scripts/audit_musveren_weights.py` (read-only audit of exporter weights) | `SkinWeightAttributeAllowListTests`; a new module that touches skin weights fails until it is listed |

Every repair, restore and preserve step is listed below: Python functions
named `repair_*`, `restore_*` or `preserve_*` under `scripts/` (vendor
excluded), files directly under `scripts/` named `repair-*`, `restore-*` or
`preserve-*`, glTF repair record kinds written by `scripts/native_assets_lib`,
and `fnRepair*` or `repair*` exports under `src/` (none today). The defect
evidence is a repo path that shows the defect, or an explicit unresolved note
naming the missing proof. `SourcePreservationCensusTests` fails on a missing
step, on a row for a step that no longer exists and on evidence that is
neither.

| Step | Kind | Where | Defect evidence | Preserves |
| --- | --- | --- | --- | --- |
| `repair_empty_primitives` | function | `scripts/native_assets_lib/empty_primitives.py` | `tests/pipeline/test_empty_primitives.py:39` | Buffer bytes, nodes and material slots; removed primitives, accessors and views and every remap are recorded |
| `omit-empty-native-primitives` | record kind | `scripts/native_assets_lib/empty_primitives.py` | `tests/pipeline/test_empty_primitives.py:39` | `bytesPreserved`, `materialSlotsPreserved` and `materialSlotCount` in the record |
| `repair_bounds` | function | `scripts/native_assets_lib/gltf.py` `Document` | `tests/pipeline/test_native_assets.py:61` | Buffer bytes, including inverse bind matrices; only accessor `min` and `max` are recomputed from them |
| `repair_vertex_metadata` | function | `scripts/native_assets_lib/gltf.py` `Document` | unresolved: no test or evidence doc reproduces the zero-vector tangents build1590 is said to emit | The tangent accessor and its bytes; only the primitive's `TANGENT` attribute is dropped, and buffer view targets are set |
| `omit-zero-tangent-attribute` | record kind | `scripts/native_assets_lib/gltf.py` | unresolved: no test or evidence doc reproduces the zero-vector tangents build1590 is said to emit | The removed accessor index with `bytesPreserved` |
| `preserve_material_graph` | function | `scripts/native_assets_lib/material_graph.py` | `scripts/native_assets.py:350` | The raw native material graph, texture sources and dependency hashes under `native-materials/`; glTF slots stay diagnostic |
| `restore_mapped_static_normals` | function | `scripts/native_assets_lib/static_normals.py` | `tests/pipeline/test_native_static_normals.py:147` | Source normal floats without renormalisation (`normalizationApplied: false`); every other byte, with before and after hashes |
| `restore_native_static_normals` | function | `scripts/native_assets_lib/static_normals.py` | `tests/pipeline/test_native_static_normals.py:147` | As `restore_mapped_static_normals`, plus the qualified source proof |
| `restore_glb_static_normals` | function | `scripts/native_assets_lib/static_normals.py` | `tests/pipeline/test_native_static_normals.py:147` | The original GLB JSON bytes and every byte outside the normal spans |
| `restore-original-static-normal-floats` | record kind | `scripts/native_assets_lib/static_normals.py` | `tests/pipeline/test_native_static_normals.py:147` | `allNonNormalBytesUnchanged`, `jsonMetadataUnchanged` and the binary hashes in the record |
| `restore-native-static-normals.py` | file | `scripts/restore-native-static-normals.py` | `tests/pipeline/test_native_static_normals.py:147` | Writes a new derived archive; the source archive and exports stay unchanged |
| `restore_native_weights` | function | `scripts/native_assets_lib/weights.py` | `tests/pipeline/test_native_weights.py:122` | The original exporter buffer (`originalBufferBytesPreserved`, `originalBufferSha256`) and `originalAttributes`; exact source slots travel in `_L2_NATIVE_WEIGHTS` and `_L2_NATIVE_JOINTS` |
| `restore_l2_ogg` | function | `scripts/native_assets_lib/world_music.py` | `tests/pipeline/test_native_music.py:49` | The original L2SD payload path, size and SHA-256 and the reversible patch, checked by `unpatch` |
| `preserve-native-editor-uv2.mjs` | file | `scripts/preserve-native-editor-uv2.mjs` | `tests/editor/nativeEditorUv2.test.ts:78` | Authored Editor state and the original file; only lost UV2 is appended to a new addressed binary |
| `preserve-native-editor-fog.mjs` | file | `scripts/preserve-native-editor-fog.mjs` | `tests/editor/editorFogExport.test.ts:7` | Saved Editor resources; only the packed scene's `fogMode` follows the saved `fogEnabled` |

## How the catalog lists assets

`/l2/catalog.json` is schemaVersion 1. Its slices are `models`, `textures`,
`sections`, `movers`, `npcProfiles`, `playerProfiles`, `animationAudio`,
`combatAudio`, `worldAudio` and `effectComponents`. A model record carries
`id`, `archive` (`/l2/<archiveSha256>/asset.l2asset`), `archiveSha256` and
`source.object`; manifest records carry `id`, `manifest`, `manifestSha256` and
`manifestBytes`.

`buildNativeCatalogIndex` turns the catalog into L2-ID keys:

| Key | Converted when |
| --- | --- |
| `npc:<npcId>` | A staged NPC profile's mesh matches a model's `source.object` |
| `item:<itemId>` | A staged player profile lists the item with a staged model |
| `skill:<skillId>:<level>` | An effect component id has the form `interlude:skill:<id>:level:<level>:` |
| `window:<name>` | Never yet; interface windows are not converted (UI-01) |
| `tile:<XX_YY>` | A section id has the form `map-XX-YY-section` |

Any other key answers `not-in-catalog` with a reason. The client loads assets
only through `readNativeCatalog`. `recipes/native-inputs.lock.json` pins
converter inputs only; it is not an output catalog (DEC-OWN-5).

## Lane stores

Each lane writes its own store under `artifacts/lane-store/<lane>/l2/`, for
the lanes `world`, `actors`, `data-ui` and `integration` named in
`.planning/lanes.json`. The folder is ignored by git.
`scripts/native_store/store_paths.py` builds every lane path
(`lane_store_root`, `lane_work_root`, `lane_gap_rows_path`,
`lane_load_check_path`) and refuses an unknown lane name.

A lane store reuses the shared store prefixes exactly:

| Prefix | What sits there |
| --- | --- |
| `<archiveSha256>/` | Model and texture archives: `asset.l2asset` with `model.glb` or `texture.png` beside it, no kind prefix |
| `maps/<manifestSha256>/map-section-runtime/` | Section runtime manifests (`manifest.json`) |
| `npc-profiles/<sha>/`, `player-profiles/<sha>/` | NPC and player profiles |
| `world-audio/<sha>/`, `animation-audio/<sha>/`, `combat-audio/<sha>/`, `step-sounds/<sha>/` | Audio bundles |
| `effects/<sha>/`, `movers/<sha>/` | Effect components and movers |
| `skies/`, `environments/` | Outside the catalog |

The prefix `/l2/models/<sha>/` is never used. New kinds get new prefixes in
plan 02-04. That one contract change registers three tile resource kinds
together (DEC-OWN-12, provisional, owner review): `bsp-visibility` (one per
tile, VIS-01), `native-tile-collision` (BSPT per map; VOLS, SMSH, PLAC, TERR
and MOVR per chunk; WORLD-08, MOVE-01) and `lighting` (one per tile, MAT-02).
Each is an `.l2asset` whose `asset.json` records units (source) and axes
(UE2, Z up), written by `scripts/world/typed_payload.py` and read by
`src/shared/typedPayload.ts`. The per-tile Emitter actor export (FX-01) is
registered in the same change, as its own kind or as a field of an existing
kind. Every resource name satisfies the `nativeResourceUrl.ts` path
rule. Beside `l2/`, a lane folder holds `work/` (the unit ledger, plan 02-02),
`gap-rows/` (plan 02-02) and `load-checks/` (plan 02-06).

Output guard: `require_converter_output` accepts only a dedicated folder under
`artifacts/`. It refuses `artifacts/` itself, anything at or under the
realpath of `public/l2`, and any path with a junction or symlink on it, before
the first write. `Converter`, `native_batch.prepare` and every lane entry point
with an `--output` option call it. Restaging a lane store into the shared
store is integration work in the main checkout only.

## Dev store switch

`vite/nativeStoreRootPlugin.ts` lets the dev server on port 5175 serve a lane
store without touching `public/l2`. `NATIVE_STORE_ROOT` takes the
`.planning/lanes.json` keys (`world`, `actors`, `data-ui`, `integration`),
which serve `artifacts/lane-store/<lane>/l2`, or `fixture`, which serves the
committed `tests/fixtures/lane-store/l2` (one golden model and its catalog).
Unset, the plugin does nothing. An unknown value, a missing folder, a root
whose realpath differs from its path (a junction or symlink on the way) or a
root at or under the realpath of `public/l2` stops Vite with the reason.

- `/l2/catalog.json` and `/l2/coverage.json` come only from the selected root.
  When the root lacks them the answer is 404, never the shared store's copy.
- Every other `/l2/` path comes from the selected root first, then from
  `public/l2`, read only. Each file must be a regular file whose path and
  realpath stay under its root.
- The header `X-Native-Store-Source: lane` or `shared` names which store
  answered. A missing file answers 404 instead of the SPA page; only GET and
  HEAD are served.
- Request paths are checked against a copy of the `nativeResourceUrl.ts`
  regex after one decode. `tests/unit/nativeStoreRootPlugin.test.ts` feeds the
  same cases to both and checks that the copy's source text appears in
  `nativeResourceUrl.ts`. Encoded traversal such as `/l2/%2e%2e/package.json`
  answers 400.
- Content types: `.json` `application/json`, `.glb` `model/gltf-binary`,
  `.png` `image/png`, `.ogg` `audio/ogg`, `.wav` `audio/wav`, `.l2asset`
  `application/zip`, anything else `application/octet-stream`.
- One byte range answers 206 with `Content-Range`; an unsatisfiable range
  answers 416 with `Content-Range: bytes */<size>`; several ranges or a
  malformed header get the full 200 body.
- The plugin has `apply: "serve"`. `tests/unit/nativeStoreRootBuildAbsence.test.ts`
  resolves `vite.config.ts` in both modes and finds `native-store-root` only
  in serve mode. A production bundle built with `publicDir: false` holds
  neither `NATIVE_STORE_ROOT` nor `native-store-root`. Plain `pnpm build`
  is not used for this check, because it would copy the `public/l2` junction.

## Load-check records

A browser check that loads a catalog key records the result in
`artifacts/lane-store/<lane>/load-checks/<catalogSha256>.json`, written by
`tests/browser/support/loadCheckRecordFile.ts`. `fixture` is not a lane and
gets no records.

```
{"schemaVersion": 1, "lane": "<lane>", "catalogSha256": "<64 hex>",
 "records": [{"key", "status", "reason", "atRiga", "assetManifestSchemaVersion"}]}
```

- `key` is a gap-row catalog key (`tile`, `map`, `npc`, `item`, `skill`,
  `table`, `window`, `character`).
- `status` is `pass` with `reason` null, or `failed` with a non-empty reason.
  Only what a browser check observed is recorded; an unverified key has no
  record.
- `atRiga` is ISO 8601 with the Riga offset, for example
  `2026-11-08T15:05:00+02:00`.
- `assetManifestSchemaVersion` is 1, 2 or null (keys with no asset package,
  such as tiles or windows). It notes v1 or v2 because an overlay lane store
  mixes the v1 shared store with v2 lane archives until the restage.
- One record per key, sorted by key. Each write replaces that key's record and
  rewrites the file through a temp file in the same folder and a rename.
- The file is pinned to the served catalog: `hashServedLaneCatalog(baseUrl)`
  gives the SHA-256, and a new catalog SHA-256 starts a new file. A reader
  refuses a file whose `lane` or `catalogSha256` differs from its path.
- Coverage counts "loads" only from these records.

## Golden fixtures

`tests/fixtures/golden/` holds synthetic fixtures with no Lineage II bytes:
`model-v1.l2asset`, `model-v2.l2asset`, `audio-v2.l2asset`, a synthetic
`reference-client-tree.lock.json` (the fixture `clientBuild` source) and
`l2/catalog.json` (two models, one skill effect component, section
`map-00-00-section`, which is outside the real map grid).

`tests/fixtures/golden/fixtures.lock.json` pins each fixture by SHA-256 and
byte length, in sorted path order. Binaries are hashed raw; JSON is hashed in
its `json_bytes` canonical form, so CRLF checkouts do not change the pins.
`.gitattributes` marks the folder `-text`.

Regenerate with:

```
python -B scripts/generate_golden_fixtures.py --output tests/fixtures/golden
```

The generator reads no client tree and no store. `tests/pipeline/test_asset_manifest_v2.py`
regenerates into a temp folder and compares every file;
`tests/unit/assetPackageContract.test.ts` checks each pin before it reads a
fixture.

## Transition from v1

The staged store in `public/l2` is v1. Converters write v2 from plan 01-12 on.
Until the integration thread restages `public/l2` to v2 from the main
checkout, `readAssetPackage.ts`, `nativePowerStrikeSource.ts` and
`asset_manifest.py` accept both v1 and v2. After that restage, v1 acceptance is
deleted from all three (tracked under Needs Human in
[.planning/STATE.md](../.planning/STATE.md)).
