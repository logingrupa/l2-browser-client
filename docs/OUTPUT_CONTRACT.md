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
| `clientBuild.engineDllSha256` | 64 hex | The lock's `system/Engine.dll` record, which must be class `equal` |
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
