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
| `restore_native_weights` | function | `scripts/native_assets_lib/weights.py` | `tests/pipeline/test_native_weights.py:122` | The original exporter buffer (`originalBufferBytesPreserved`, `originalBufferSha256`) and `originalAttributes`; exact source slots travel in `_L2_NATIVE_WEIGHTS` and `_L2_NATIVE_JOINTS` |
| `restore_l2_ogg` | function | `scripts/native_assets_lib/world_music.py` | `tests/pipeline/test_world_music_helpers.py:43` | The original L2SD payload path, size and SHA-256 and the reversible patch, checked by `unpatch` |
| `preserve-native-editor-uv2.mjs` | file | `scripts/preserve-native-editor-uv2.mjs` | `tests/editor/nativeEditorUv2.test.ts:78` | Authored Editor state and the original file; only lost UV2 is appended to a new addressed binary |
| `preserve-native-editor-fog.mjs` | file | `scripts/preserve-native-editor-fog.mjs` | `tests/editor/editorFogExport.test.ts:7` | Saved Editor resources; only the packed scene's `fogMode` follows the saved `fogEnabled` |

## How the catalog lists assets

`/l2/catalog.json` is schemaVersion 1. Its slices are `models`, `textures`,
`sections`, `movers`, `npcProfiles`, `playerProfiles`, `animationAudio`,
`combatAudio`, `worldAudio`, `effectComponents`, `tiles`, `tables` and
`windows`. A model record carries `id`, `archive`
(`/l2/<archiveSha256>/asset.l2asset`), `archiveSha256` and `source.object`;
manifest records carry `id`, `manifest`, `manifestSha256` and
`manifestBytes`. A lane catalog also carries the top-level
`sourceCatalogSha256`: the SHA-256 of the shared catalog it was built on
(`write_lane_catalog.py`, plan 02-03).

`merge_catalog_slice` in `scripts/native_store/catalog_writer.py` calls
`validate_catalog_record(slice_name, record)` before it merges, so a lane
cannot add a malformed record. Every slice needs a non-empty string `id`. The
new slices hold exactly these fields:

| Slice | Record | Bounds |
| --- | --- | --- |
| `tiles` | `{id, manifest, manifestSha256, manifestBytes}` | `id` is `XX_YY`; `manifest` is `/l2/tiles/<manifestSha256>/tile.json`; `manifestBytes` 1 to 8,000,000 (`TILE_MANIFEST_MAXIMUM_BYTES`) |
| `tables` | `{id, manifest, manifestSha256, manifestBytes, recordCount, sourceSha256}` | `id` is the inventory table name, lower case only (`^[a-z][a-z0-9_]*(?:-[a-z])?$`, for example `npcgrp`, `skillname-e`), or a derived `native-table-name-index` id ending in `_names` (for example `npcname_e_names`), which coverage keeps outside the data denominator; `manifest` is `/l2/tables/<manifestSha256>/<id>.json`; `manifestBytes` 1 to 32 MiB (`TABLE_MANIFEST_MAXIMUM_BYTES`); `recordCount` a safe integer of at least 0; `sourceSha256` 64 hex. The records stay in the manifest, fetched on demand, never inlined. The slice holds at most one record per inventory table (`EXPECTED_DAT_TABLE_COUNT`, the 40 `system/*.dat` files of the reference client lock) plus one per name index source (3): `TABLES_CATALOG_CAPACITY` 43 in `convert_tables.py`, the one capacity both `convert_tables.py` and `table_name_indexes.py` merge with |
| `windows` | `{id, manifest, manifestSha256, manifestBytes}` | `id` is `<name>` or `<name>#<ordinal>` (`^[A-Za-z][A-Za-z0-9_]{0,63}(?:#[1-9]\d{0,3})?$`); `manifest` is `/l2/windows/<manifestSha256>/window.json`; `manifestBytes` 1 to 8,000,000 (`WINDOW_MANIFEST_MAXIMUM_BYTES`) |

Every manifest path also matches the `nativeResourceUrl.ts` path rule, and
the SHA-256 in the path equals the pinned `manifestSha256`. A record whose id
already exists with other content is refused ("differs; preserved"); an
identical one is kept once, so a re-merge leaves the catalog bytes unchanged.
New records are appended after the existing ones.

`buildNativeCatalogIndex` turns the catalog into L2-ID keys. A lookup answers
`converted`, `not-in-catalog` with a reason, or `gap` with the reason of a
`/l2/coverage.json` row whose key the catalog lacks:

| Key | Converted when |
| --- | --- |
| `npc:<npcId>` | A staged NPC profile carries `modelCatalogId` naming a `models` record whose `source.object` is exactly the profile `mesh`; a profile naming a model of another mesh makes the whole index unavailable, so `write_lane_catalog.py` and `merge_lane_store.py` refuse that lane. A profile without that field (the currently staged store) keeps the exact single-mesh join on `source.object` until the restage |
| `item:<itemId>` | A staged player profile lists the item with a staged model |
| `skill:<skillId>:<level>` | An effect component id has the form `interlude:skill:<id>:level:<level>:` |
| `table:<name>` | A `tables` record has that id |
| `window:<id>` | A `windows` record has that id. Until a catalog has window records, a missing window answers "interface windows are not converted yet (UI-01)" |
| `tile:<XX_YY>` | A `tiles` record has that id; a legacy section id `map-XX-YY-section` still answers when no tiles record exists for that tile |
| `character:<chargrpIndex>` | A staged player profile carries `chargrpIndex` |

The two optional profile fields are `modelCatalogId` (pattern
`^[a-z0-9][a-z0-9:-]{0,95}$`, the `id` of a `models` record) and
`chargrpIndex` (a safe integer of at least 0). Any other key answers
`not-in-catalog` with a reason. The client loads assets
only through `readNativeCatalog`. `recipes/native-inputs.lock.json` pins
converter inputs only; it is not an output catalog (DEC-OWN-5).

## Manifest kinds

`scripts/native_store/tile_manifest_validation.py` validates the two tile
kinds (`validate_tile_manifest`, `validate_tile_chunk_manifest`) and raises
`TileManifestError`. Vectors are lists of three finite numbers; object names
are qualified (`Package.Object`). Gap rows inside a manifest are valid gap
rows keyed `tile:<tileId>`, one per step, sorted by step.

`native-tile-runtime` v1, at `/l2/tiles/<sha>/tile.json`, one per tile:

| Field | Value |
| --- | --- |
| `kind`, `schemaVersion` | `native-tile-runtime`, `1` |
| `tileId` | `XX_YY` |
| `sourceMap`, `sourceSha256` | `maps/<tileId>.unr` and its SHA-256 |
| `frame` | `{terrainInfo, location, terrainScale}`: the TerrainInfo object and its `Location` and `TerrainScale` vectors |
| `anchor` | `{playerStart, location}`: the first enabled PlayerStart in source order |
| `chunks` | 1 to 256 `{chunkId, manifest, manifestSha256, manifestBytes}`, manifest `/l2/maps/<manifestSha256>/native-tile-chunk-runtime/manifest.json`, at most 8,000,000 bytes, sorted by (column, row) as integers, no chunk twice. A tile with no chunk is a gap row, not a manifest |
| `resources` | `{kind, manifest, manifestSha256, manifestBytes}` with `kind` in the vocabulary below, a hash-addressed manifest path (`/l2/[<prefix>/]<manifestSha256>/<file>`), at most 128 MiB (the `.l2asset` archive limit), sorted by `(kind, manifest)`. One kind may appear several times; the same `(kind, manifest)` pair twice is refused |
| `gaps` | Gap rows for the tile |

`native-tile-chunk-runtime` v1, at
`/l2/maps/<sha>/native-tile-chunk-runtime/manifest.json`, one per chunk of
4x4 sectors (`CHUNK_SECTOR_SPAN`):

| Field | Value |
| --- | --- |
| `kind`, `schemaVersion`, `tileId` | `native-tile-chunk-runtime`, `1`, `XX_YY` |
| `chunkId` | `chunk-<column>-<row>`, 0-based on the 4x4-sector grid |
| `sectorRange` | `{firstColumn, lastColumn, firstRow, lastRow}`; `firstColumn` and `firstRow` are multiples of 4, 1 to 4 sectors per axis, and the chunk id is `chunk-<firstColumn / 4>-<firstRow / 4>`, so neighbouring chunks share an edge and never overlap |
| `terrain` | `null` or `{resource, sha256, maskUvRule}`; `maskUvRule` is in the vocabulary (`extrapolated` outside the 20_20 capture) |
| `bsp`, `collision` | `null` or `{resource, sha256}`; collision is its own resource and is never fed by LOD |
| `models` | Zero or more `{id, archive, archiveSha256, placements}`, archive `/l2/<archiveSha256>/asset.l2asset`, `placements` a list, no id twice |
| `gaps` | Gap rows for the tile; a `null` terrain, bsp or collision needs a gap row for that step whose status is not `pass` |

Component resource paths are hash-addressed like tile resources, with the
SHA-256 in the path equal to `sha256`. The old `map-section-runtime` kind stays
while the served store holds the 20_20 section record; its converter chain was
retired by plan 02-71, and the kind leaves with the restage.

`native-table` v1, at `/l2/tables/<sha>/<table>.json`, one per decoded table:
`{kind: "native-table", schemaVersion: 1, table, sourcePath, sourceSha256,
descriptorSha256, route, recordCount, records}`. `route` is
`local-descriptor` or `elbera-adapter`; `recordCount` equals the length of
`records` and the catalog record's `recordCount`. A `FLOAT` field whose
float32 is NaN or infinite is written as
`{"nonFiniteFloat32SourceBytes": "<8 uppercase hex, source byte order>"}`
(`NON_FINITE_FLOAT32_KEY` in `scripts/native_catalog/tables.py`), so the
canonical JSON keeps the client's exact bits; every finite float stays a JSON
number.

`native-window-layout` v1, at `/l2/windows/<sha>/window.json`, one per root
window of `interface.xdat` (the original Interlude interface, DEC-OWN-10):
`{kind: "native-window-layout", schemaVersion: 1, windowId, name,
sourceSha256, sourceOffset, root, textureRefs, anchorProof}`. `root` holds the
header fields, `children` and `tail: {offset, end, sha256}`. `anchorProof` is
"Elbera NWindow af6c3437 proof, unverified on IMPORTA 7c12fb6b". Duplicate
rule: a root name that appears once keeps its bare name as `windowId`; a
repeated root name gives every occurrence `<name>#<ordinal>`, 1-based in
source order.

### Tile manifest vocabulary

The integration base sets are `TILE_RESOURCE_KINDS_BASE = ()` and
`MASK_UV_RULES_BASE = ('extrapolated',)`. Every other kind and mask rule comes
from the world-owned `recipes/world/tile-manifest-vocabulary.json`, which
`load_tile_manifest_vocabulary` unions with the base sets:

```
{"schemaVersion": 1, "listVersion": <integer of at least 1>,
 "resourceKinds": [<non-empty string>], "maskUvRules": [<non-empty string>]}
```

- The validator requires the file. A missing file raises `TileManifestError`
  naming its path; there is no fallback. Importing the module reads no file.
- Exactly these four keys. Either list may be empty. A string repeated inside
  a list, or equal to a base entry (so `extrapolated` never appears in the
  file), is refused.
- Creator: plan 02-16 creates it as `{schemaVersion: 1, listVersion: 1,
  resourceKinds: [], maskUvRules: []}` before its first validation. No plan
  creates it conditionally, and 02-04 never writes it.
- Extenders: 02-30 `native-tile-collision`, 02-31 `movers`, 02-45 `sky` and
  `world-audio`, 02-50 `minimap`, 02-61 `map-emitters` and `bsp-visibility`,
  02-62 `lighting`. A world plan appends its kind or mask rule and bumps
  `listVersion` by one per added entry, in the commit that adds the step
  writing it and before that step's first validation. A kind or rule that is
  not listed is refused, so a missing entry fails loudly.

The DEC-OWN-12 tile resource kinds (provisional, owner review):

- `native-tile-collision`: the BSPT group per map as a tile resource, and the
  chunk `collision` resource with the VOLS, SMSH, PLAC, TERR and MOVR groups
  (WORLD-08, MOVE-01).
- `bsp-visibility`: one per tile (VIS-01).
- `lighting`: one per tile (MAT-02).
- `map-emitters`: the per-tile Emitter actor export (FX-01), a JSON manifest
  like `movers`.

The first three are `.l2asset` packages whose `asset.json` records units
`source` and axes UE2 Z up (`.planning/PROJECT.md`), written by
`scripts/world/typed_payload.py` and read by `src/shared/typedPayload.ts`.

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
| `tiles/<sha>/tile.json`, `maps/<sha>/native-tile-chunk-runtime/manifest.json` | Tile and chunk manifests (see "Manifest kinds") |
| `native-materials/<sha>/graph.json`, `native-materials/<sha>/program.json` | Source-preserving UE2 material graph of one root and its typed program (plan 02-59, `write_native_material_resources`). `<sha>` is the SHA-256 of `program.json`, which holds the graph's `graphSha256`. Every program field is `authored`, `class-default` or `ue-zero` |
| `skies/`, `environments/` | Outside the catalog |

The prefix `/l2/models/<sha>/` is never used. The tile resource kinds,
including the DEC-OWN-12 kinds, are listed under "Manifest kinds". Every
resource name satisfies the `nativeResourceUrl.ts` path rule. Beside `l2/`, a lane folder holds `work/` (the unit ledger, plan 02-02),
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

- For a lane, `/l2/catalog.json` is the catalog the restage would write: the
  `public/l2` catalog with the lane records merged by the `merge_lane_store.py`
  rule (`lane_union_catalog`). The plugin reads it from
  `scripts/native_store/print_lane_union_catalog.py`, so the merge rule has one
  owner in Python. A lane catalog whose `sourceCatalogSha256` differs from the
  served `public/l2` catalog stops Vite at startup and answers 409 with the
  reason on request. `fixture` serves its own catalog alone.
- The catalog answer names the lane catalog it came from in
  `X-Native-Store-Lane-Catalog-Sha256`. A lane catalog pins its shared base,
  so this one SHA-256 identifies the served union.
- `/l2/coverage.json` comes only from the selected root. When the root lacks a
  catalog or coverage the answer is 404, never the shared store's copy.
- Every other `/l2/` path comes from the selected root first, then from
  `public/l2`, read only. Each file must be a regular file whose path and
  realpath stay under its root.
- The header `X-Native-Store-Source: lane`, `shared` or `union` names which
  store answered. A missing file answers 404 instead of the SPA page; only GET
  and HEAD are served.
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
- The file is pinned to the lane catalog the served catalog came from:
  `servedLaneCatalogSha256(baseUrl)` reads it from
  `X-Native-Store-Lane-Catalog-Sha256`, the same SHA-256 the coverage join reads
  from the lane store, and a new catalog SHA-256 starts a new file. A reader
  refuses a file whose `lane` or `catalogSha256` differs from its path.
- Coverage counts "loads" only from these records.

## Gap rows

`scripts/native_store/gap_rows.py` (plan 02-02) owns the row schema. A gap
row is exactly `{key, part, step, status, reason, sourceIdentity, evidence}`:

- `key` is a catalog key: `tile:<XX_YY>`, `map:<name>` (the non-tile maps),
  `npc:<id>`, `item:<id>`, `skill:<id>:<level>`, `table:<name>`,
  `window:<id>` or `character:<chargrpIndex>`.
- `part` is a Stage A part of the `world`, `actors` or `data-ui` lane in
  `.planning/lanes.json`; `step` matches `^[a-z][a-z0-9-]{0,63}$`.
- `status` is `pass`, `gap`, `pending` or `failed`. `pass` has `reason`
  null; every other status needs a listed reason.
- Reasons form a closed list. The seed is `scripts/native_store/gap_reasons.json`
  (`{schemaVersion: 1, listVersion, reasons}`); a lane adds a reason only to
  its own `recipes/world/gap-reasons.json`, `recipes/actors/gap-reasons.json`
  or `recipes/data/gap-reasons.json` and bumps that file's `listVersion`.
  `<name>` placeholders match any text; `step-pending:<step>` is the one reason
  for a step that has not run yet.
- `sourceIdentity` is `{path, sha256, object?}` with a relative path and a
  qualified object name; `evidence` is a repository- or lane-relative path.

`write_gap_rows` writes one file per lane and step,
`artifacts/lane-store/<lane>/gap-rows/<step>.json`, as
`{schemaVersion: 1, lane, step, reasonListVersions, rows}` with rows sorted by
key and one row per key, through the one atomic writer
`catalog_writer.replace_file`.

## Coverage report

`coverage.json` v1 lives at `<store root>/coverage.json`, served as
`/l2/coverage.json`, outside the catalog so that no SHA-256 becomes circular.
Plan 02-07 writes it and 02-26 completes it.

```
{"schemaVersion": 1, "catalogSha256": "<64 hex>", "storeRoot": "<path>",
 "generatedAtRiga": "<ISO 8601 with the Riga offset>",
 "denominators": {"<part>": {"count": <integer> | "unknown", "source": "<committed file>"}},
 "parts": {"<part>": {"denominator", "converted", "loads": {"pass", "failed", "unverified"}, "gap", "pending"}},
 "rows": [{"key", "part", "status", "reason", "converted", "loads", "steps": [{"step", "status", "reason"}]}]}
```

- `rows` holds one row per denominator key. `steps` lists that key's gap
  rows, one per step, so each tile records pass or gap per step (WORLD-03).
- A reader refuses a coverage file whose `catalogSha256` differs from the
  served catalog. Under the dev store switch it also accepts the lane catalog
  SHA-256 that the catalog answer attests in
  `X-Native-Store-Lane-Catalog-Sha256` (`readNativeCatalog` keeps it as
  `laneCatalogSha256`, and a malformed header makes the catalog invalid).
  Without that header, as in production, only the served catalog matches.
- "Loads" counts only from load-check records; everything else is
  `unverified`.

## Golden fixtures

`tests/fixtures/golden/` holds synthetic fixtures with no Lineage II bytes:
`model-v1.l2asset`, `model-v2.l2asset`, `audio-v2.l2asset`, a synthetic
`reference-client-tree.lock.json` (the fixture `clientBuild` source) and
`l2/catalog.json` (two models, one skill effect component, section
`map-00-00-section`, tile `00_00`, table `syntheticfixture` and window
`SyntheticFixtureWnd`). Tile `00_00` lies outside the real map grid. Its
`native-tile-runtime` manifest sits under `l2/tiles/<sha>/tile.json` and lists
one `native-tile-chunk-runtime` manifest, `chunk-0-0`, under
`l2/maps/<sha>/native-tile-chunk-runtime/manifest.json`, with terrain, bsp
and collision null and a `step-pending:<step>` row per step. The table and
window manifests sit under `l2/tables/<sha>/syntheticfixture.json` and
`l2/windows/<sha>/window.json`. Every value in them is synthetic.

`tests/fixtures/catalog-index-keys.json` is the key list the key table above
gives for the golden catalog: `skill:0:1`, `table:syntheticfixture`,
`tile:00_00` (from the tiles record and the legacy section) and
`window:SyntheticFixtureWnd`. The writer half owns it; the browser index
(02-05) and the Python report (02-07) both assert equality with it.

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
