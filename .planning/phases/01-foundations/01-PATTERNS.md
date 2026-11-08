# Phase 1: Foundations - Pattern map

**Mapped:** 2026-11-08
**Files analyzed:** 34 new or modified (grouped below)
**Analogs found:** 30 / 34

Every analog below is git-tracked source in this worktree. All excerpts carry comments that exist today; AGENTS.md requires the copying file to drop every comment and keep only code. Line numbers are as of commit d8fdff8.

## File classification

| New/modified file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `src/scene/presentationConfiguration.ts` | config | static data | `assets/native-parity.scene/config.json`, `cameras/World camera.json` (values); `src/ui/devSheet/types.ts` (typed plain data) | role-match |
| `src/scene/buildPresentationScene.ts` | service | transform | `src/scene/loadEnvironment.ts:63-82` (camera field assignment) | role-match |
| `src/scene/loadEnvironment.ts` (rewrite to router) | controller | request-response | itself `:43-90` | exact |
| `src/scene/authoredNativeWorld.ts` | service (dynamic import target) | request-response | `src/scene/loadEnvironment.ts:44-62` (`loadAuthoredScene`) | exact |
| `src/scene/openBabylonInspector.ts` | utility (dynamic import target) | event-driven | RESEARCH Pattern 10 | none in repo |
| `src/scene/navigation/meshNavigation.ts` | move of `src/world/meshNavigation.ts` | transform | itself | exact |
| `src/runtime/createNativeSliceRuntime.ts` split (`nativeSliceDiagnostics.ts`, `loadNativeSliceWorld.ts`, `loadNativeSliceAudio.ts`, `createNativeSliceEffects.ts`, `attachNativeSliceSheet*.ts`) | composition root | event-driven | itself (`:895-914` diagnostics, `:498-520` sheet groups) | exact |
| `src/runtime/nativeSandboxConfiguration.ts` | config | static data | `src/scripts/nativeParity.ts:10-30` fields + saved values in `assets/native-parity.scene/config.json` | exact |
| `src/runtime/sandboxCommands.ts` | controller | request-response | `createNativeSliceRuntime.ts:498-520` sheet actions; `src/ui/devSheet/types.ts` | role-match |
| `src/assets/native/readNativeCatalog.ts` | service | file-I/O (fetch) + validation | `src/assets/native/loadNativeCatalog.ts:6-15` | exact |
| `src/assets/native/nativeCatalogIndex.ts` | utility | transform | `loadNativeCatalog.ts:17-35` (record validation, id set) | role-match |
| six/seven catalog fetch sites (`loadNativeCatalog.ts`, `loadNativeSection.ts:146`, `loadNativeWorldAudio.ts:101`, `nativeEffectComponents.ts:110`, `loadNativeMovers.ts:47`, `loadNativeCombatAudio.ts:144`, `src/editor/captureNativeWorld.ts:81`) | service | file-I/O | `loadNativeCatalog.ts` | exact |
| `src/assets/package/readAssetPackage.ts` (v1 or v2) | model + validator | transform | itself `:2-16`, `:82-91` | exact |
| `src/effects/nativePowerStrikeSource.ts:81` | validator | transform | `readAssetPackage.ts` | exact |
| `src/world/worldTypes.ts` (spawn-npc, equip-item, cast-skill, skill-cast, npcId) | model | event-driven | itself `:13-25`, `:50-62` | exact |
| `src/world/MockWorldAdapter.ts`, `src/world/NativeSliceAdapter.ts` | service | event-driven | each other | exact |
| `src/ui/nativeLocomotionControls.ts:2` (narrow type import) | component | event-driven | itself | exact |
| `src/ui/devSheet/*` ID-entry control + DevSheet.ts split | component | event-driven | `src/ui/devSheet/types.ts` | role-match |
| `src/ui/EntityLabel.ts` reuse for missing-asset marker | component | event-driven | itself | exact |
| `scripts/native_assets.py` (v2 writer + verifier) | service | file-I/O | itself `:113-131`, `:134-137`, `:674-677` | exact |
| `scripts/hash_reference_client_tree.py` | utility | batch / file-I/O | `scripts/native_source_stage.py:106-139` | role-match |
| `scripts/build_reference_client_lock.py` | utility | batch / transform | `scripts/native_assets_lib/gltf.py:20-21` (`json_bytes`) + `recipes/native-inputs.lock.json` shape | role-match |
| `scripts/reference_client_guard.py` | middleware | request-response | `native_source_stage.py` `validate_source_root` / `relative_path` | role-match |
| every `--client` entry point (about 20 scripts) | config | request-response | `native_assets.py:762`, `native_catalog/cli.py:208` | exact |
| `scripts/build_dat_table_inventory.py` | utility | batch | `scripts/native_catalog/tables.py:1-30` | role-match |
| `scripts/generate_golden_fixtures.py` + fixture lock | utility | batch | `tests/fixtures/assetPackageFixture.ts` | role-match |
| `recipes/reference-client-tree.lock.json` | config | static data | `recipes/native-inputs.lock.json` | exact |
| `tests/unit/gameWorldAdapterContract.test.ts` | test | n/a | RESEARCH Pattern 4; `tests/unit/world.test.ts` | role-match |
| `tests/unit/staticImportGraph.test.ts` (Editor, inspector, adapter boundaries) | test | n/a | `tests/unit/editorScript.test.ts:12-27` | exact |
| `tests/unit/presentationConfigurationParity.test.ts` | test | file-I/O | `tests/browser/nativeSlice.spec.ts:38-67` (`authoredState()` reads scene JSON) | role-match |
| `tests/pipeline/test_reference_client_guard.py`, `test_dat_table_inventory.py`, `test_client_entry_points.py` | test | n/a | `tests/pipeline/test_native_presentations.py:1-25,157` | exact |
| `vitest.editor.config.ts` + `pnpm test:editor` | config | n/a | `vitest.config.ts` | role-match |
| `package.json` scripts (`dev`, `build`, `generate:editor`) | config | n/a | itself `:15-17` | exact |
| `STATUS.md`, `DECISIONS.md`, `.planning/lanes.json`, `docs/parts/<part>/EVIDENCE.md`, `docs/OUTPUT_CONTRACT.md` | docs/config | n/a | RESEARCH "Process files"; `.planning/PROJECT.md` | none (new kind) |
| `scripts/check_lane_ownership.*` | utility | transform | none | none |

## Pattern assignments

### `src/assets/native/readNativeCatalog.ts` (service, fetch + validation)

**Analog:** `src/assets/native/loadNativeCatalog.ts`

Imports (lines 1-2):
```typescript
import { readAssetPackage, sha256, type AssetPackage } from "../package/readAssetPackage";
import { nativeResourceUrl } from "./nativeResourceUrl";
```

Fetch + guard-clause validation at the trust boundary (lines 6-15):
```typescript
async function readCatalog(signal: AbortSignal) {
  const response = await fetch(nativeResourceUrl("/l2/catalog.json"), { signal });
  if (!response.ok) throw new Error("The native asset catalog is unavailable. Restore its verified staged assets.");
  const catalog: unknown = await response.json();
  if (typeof catalog !== "object" || !catalog || !("schemaVersion" in catalog) || catalog.schemaVersion !== 1 ||
    !("models" in catalog) || !Array.isArray(catalog.models)) throw new Error("Native model catalog is invalid.");
  return { models: catalog.models as unknown[], npcProfiles: "npcProfiles" in catalog ? catalog.npcProfiles : [], ... };
}
```
Record validation with hash-addressed path check and duplicate-id rejection (lines 20-25) is the template for the index builder:
```typescript
if (typeof record !== "object" || !record || !("id" in record) || typeof record.id !== "string" ||
  !("archive" in record) || typeof record.archive !== "string" || !/^\/l2\/[a-f0-9]{64}\/asset\.l2asset$/.test(record.archive) ||
  ... || ids.has(record.id)) throw new Error("Native catalog entry is invalid.");
```
Rules: one `readCatalog` owner (memoised per `AbortSignal`), callers receive typed slices; the `"store not staged"` diagnostic comes from the `!response.ok` branch. Catalog stays `schemaVersion === 1`.

### `src/assets/native/nativeCatalogIndex.ts` (utility, transform)

**Analog:** `loadNativeCatalog.ts:17-35` plus RESEARCH Pattern 8 key sources: `npc:` from `npcProfiles` (ids already `npc:21622`, `createNativeSliceRuntime.ts:111`), `item:` from `playerProfiles[].upperItems[].itemId`, `skill:<id>:<level>` from `effectComponents`, `tile:` from `sections`, `window:` empty. Lookup result is `found | not in catalog` only (unknown ID is DATA-01).

### `src/assets/package/readAssetPackage.ts` (v1 or v2 manifest)

**Analog:** itself. Type at lines 2-14 (`schemaVersion: 1`, `source {edition, package, object, sha256}`, `model {file, unit, sourceUnitsPerMetre, sourceToGltf}`). Validator style (lines 82-91):
```typescript
function validateManifest(input: unknown): AssetPackageManifest {
  if (!record(input) || input.schemaVersion !== 1 || !text(input.id) || ...) fail("asset.json has an unsupported schema or asset kind.");
  const source = input.source;
  if (!record(source) || source.edition !== "interlude" || !text(source.package) || !text(source.object) || !hash(source.sha256)) fail(...);
```
Change: `schemaVersion: 1 | 2`; for 2 require `source.path`, `clientBuild {referenceTreeLockSha256, engineDllSha256}` (use `hash()`), `converterVersion` (`hash()`), and `coordinates` for models only. Reuse `record`, `text`, `hash`, `fail` helpers; no new helpers. Same change at `src/effects/nativePowerStrikeSource.ts:81` and `scripts/native_assets.py:126`. Test fixture: `tests/fixtures/assetPackageFixture.ts` (`storedPackage(entries)`).

### `scripts/native_assets.py` (writer v2)

**Analog:** itself. Verifier check (line 126):
```python
if manifest['schemaVersion'] != 1 or set(names) != {'asset.json', *(item['path'] for item in manifest['files'])}:
    raise ValueError('Archive differs from manifest file table')
```
Converter version source (lines 134-137):
```python
def implementation_hash():
    scripts = Path(__file__).parent
    paths = [Path(__file__), scripts / 'native_audio.py', ...]
    return sha(json_bytes({path.relative_to(scripts).as_posix(): hash_file(path) for path in sorted(paths)}))
```
Writer at `:674-677` adds `source['path']`, `clientBuild`, `converterVersion = implementation_hash()`, `coordinates` with a determinant assertion on `SOURCE_TO_GLTF` (`:32`). Other Python readers to accept 1 or 2: `derive-native-map-model.py:81`, `native_map_overlap.py:415`, `restore-native-static-normals.py:83`.

### `scripts/hash_reference_client_tree.py` (batch, file-I/O over ssh)

**Analog:** `scripts/native_source_stage.py:106-139` (`remote_hashes`). Copy: config as data, canonical root, reparse rejection on every ancestor, lowercase hex SHA-256, `ssh -o BatchMode=yes -o ConnectTimeout=8` via `subprocess.run(..., capture_output=True, check=True)`:
```python
result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', alias, 'powershell', ...], capture_output=True, text=True, timeout=180, check=True)
return json.loads(result.stdout.lstrip('\ufeff'))
```
Differ from the analog: transport is `ssh -p 2026 rolan@importa-pc.tail40ecb2.ts.net 'python -I -B - C:/Lineage2-client' < script` (no PowerShell), the walker is RESEARCH Pattern 5 (`os.scandir`, `FILE_ATTRIBUTE_REPARSE_POINT`, `hashlib.file_digest`, BelowNormal via `SetPriorityClass`), output via `sys.stdout.buffer.write(json_bytes(...))`. Do not reuse `native_source_stage.relative_path` (Pitfall 7: rejects real names with spaces and `++`).

### `scripts/build_reference_client_lock.py` and `recipes/reference-client-tree.lock.json`

**Analog:** canonical serialisation `scripts/native_assets_lib/gltf.py:20-21`:
```python
def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
```
Lock shape follows `recipes/native-inputs.lock.json` (`sourceHost`, per-file `bytes`, `sha256`). Classes: equal, e-only, importa-only, differing, volatile-config, unreadable. `clientBuild` hashes `json_bytes(lock)`, never working-tree bytes (Pitfall 6, `core.autocrlf true`); add `.gitattributes` `recipes/*.lock.json eol=lf`.

### `scripts/reference_client_guard.py` (guard)

**Analog:** guard-clause style of `native_source_stage.py` (`fleet_alias`, `validate_source_root`, `relative_path` raise `ValueError` before any read). Entry points to wire: `native_assets.py:762` (and inside `Converter.__init__` `:146-151`), `native_catalog/cli.py:208`, `native_effects.py:12`, `native_migration.py:370`, `derive-native-map-model.py:190`, `derive-native-map-overlap.py:181`, `prepare-native-player-aliases.py:206`, `report-native-animation-aliases.py:485`. A pytest scans `scripts/**/*.py` for `add_argument('--client'` and asserts the guard call.

### `scripts/build_dat_table_inventory.py`

**Analog:** `scripts/native_catalog/tables.py:16-30`. Import, do not re-list:
```python
from native_catalog.tables import SCHEMA_HASHES, SCHEMA_ROOT, TABLES
```
Verify `SCHEMA_HASHES['06_interlude.xml']` before parsing; parse with `xml.etree.ElementTree`, match `re.fullmatch(pattern, name, re.IGNORECASE)` (RESEARCH "Dat inventory route classification"). Output committed JSON; the 40-row test reads only the JSON.

### Pipeline tests (`tests/pipeline/test_*.py`)

**Analog:** `tests/pipeline/test_native_presentations.py:1-25,157`:
```python
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
...
@unittest.skipUnless((CLIENT / 'system/npcgrp.dat').is_file() and SCHEMA_ROOT.is_dir() and CRYPTO_SOURCE.is_file(), 'Staged native presentation tables or pinned formats unavailable')
class NativePresentationTableTests(unittest.TestCase):
```
unittest, `sys.path` insert of `scripts`, skip when private inputs are absent. Golden-fixture tests must not skip (synthetic bytes are committed).

### `src/world/worldTypes.ts`, adapters, contract test

**Analog:** `src/world/GameWorldAdapter.ts:8-15` (five methods) and `worldTypes.ts:50-62` union style:
```typescript
  | { readonly type: "despawn"; readonly entityId: string }
  | { readonly type: "equip-upper"; readonly itemId: number | null }
```
New variants keep `readonly` fields. Delete `load-missing-model` (`:58`), `modelUrl` path and Fallback Sentinel (`MockWorldAdapter.ts:90-91,151-166`, `WorldInterface.ts:171,178`); update `tests/unit/world.test.ts:57-62`, `worldInterfaceSheet.test.ts:38,50`. Fix the wrong "left-handed" header (`worldTypes.ts:1`) by removing it with all comments. Contract test body: RESEARCH Pattern 4 (`expectTypeOf<keyof GameWorldAdapter>()...`); guard is `pnpm typecheck`. Replace `as unknown as` adapter literals in `entityGroundClearance.test.ts:26`, `entityReadiness.test.ts:26`, `worldInterfaceSheet.test.ts:17` only if the contract test makes them fail.

### `tests/unit/staticImportGraph.test.ts`

**Analog:** `tests/unit/editorScript.test.ts:3-27`:
```typescript
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { expect, it } from "vitest";
...
const result = await build({ ..., bundle: true, platform: "browser", format: "esm", target: "es2022", write: false, metafile: true });
expect(Object.keys(result.metafile!.inputs).some(path => path.endsWith("/plugins/navmesh.js"))).toBe(true);
```
Use the closure walk of RESEARCH Pattern 3 (`packages: "external"`, follow only `kind === "import-statement"`). Assertions: no `babylonjs-editor-tools`, `@babylonjs/inspector`, `src/scripts`, `src/editor/`, `loadAuthoredNativeSection.ts` from `src/main.ts`. Plus a text scan: no `@babylonjs` under `src/world/`, concrete adapters imported only under `src/runtime/`. `editorScript.test.ts` itself moves to the editor-only Vitest config (Pitfall 11).

### `src/scene/loadEnvironment.ts`, `authoredNativeWorld.ts`, `buildPresentationScene.ts`

**Analog:** `src/scene/loadEnvironment.ts:34-90`. The Editor coupling to move out:
```typescript
import { loadScene } from "babylonjs-editor-tools";
import { scriptsMap } from "../scripts";
...
const loadAuthoredScene = (file: string) => guardSceneStartup(scene,
  onProgress => loadScene("/scene/", file, scene, scriptsMap, { quality: "high", onProgress }),
  onStatus ? { onStatus } : {});
```
`authoredNativeWorld.ts` takes lines 44-62 (including the `SceneLoaderFlags.ForceFullSceneLoadingForIncremental` block) verbatim. The router keeps `try { ... } catch { scene.dispose(); throw }` (`:43,88-90`), `requireSceneStartup(scene, "native-world")`, `scene.useRightHandedSystem = true`, `document.title`. Talking Island overrides at `:70-82` (`clearColor 0.58,0.71,0.8,1`, alpha `-Math.PI / 2.5`, beta 1.1, radius 8, limits 1-50, minZ 0.05, maxZ 4000) become config values. Builder converts plain tuples to `Vector3`/`Color4`; config imports no Babylon. Fog mode native is `0` (Pitfall 1).

### Startup barrier reuse

**Analog:** `src/scene/prepareSceneForReveal.ts:16-23`:
```typescript
export function requireSceneStartup(scene: Scene, name: string): void { startup(scene).required.add(name); }
export function registerSceneStartup(scene: Scene, name: string, ready: Promise<void>): void {
  startup(scene).tasks.set(name, ready);
  void ready.catch(() => undefined);
}
```
The router calls `requireSceneStartup` then `registerSceneStartup(scene, "native-world", runtimeReady)`, same as `src/scripts/nativeParity.ts:43-53`. `prepareSceneForReveal` and `App.ts` stay unchanged.

### Dev sheet sandbox section and variables

**Analog:** `src/ui/devSheet/types.ts:5-30`:
```typescript
export type DevVariableStatus = "native" | "presentation" | "unverified";
export interface VariableInfo { name: string; value: () => string; values?: string; source?: string; status: DevVariableStatus; }
```
Presentation config values appear with `status: "presentation"` and `source` naming the former Editor file. New ID-entry control joins the existing control union; `DevSheet.ts` (734 lines) is split when touched. Missing-asset note uses `group.note({ tone: "warning" })`; in-world marker reuses `src/ui/EntityLabel.ts`.

### `src/runtime/createNativeSliceRuntime.ts` split

**Analog:** itself. Move `window.__nativeSlice` and its `declare global` (`:895-914`) whole into `nativeSliceDiagnostics.ts` first; sheet groups `:498-520` to `attachNativeSliceSheet*.ts`. Editor couplings to inject or remove: `:96` camera lookup, `:174` `restoreEditorAuthoredMaterials`, `:176` `attachAuthoredNativeSection`, `:143,:205-207` courtyard hide, `:181-191` camera mirror. Keep `tests/unit/nativeSliceRuntime.test.ts` green at each step.

## Shared patterns

### Trust-boundary validation
**Source:** `readAssetPackage.ts:84-86` helpers `record`, `text`, `hash`, `fail`; `loadNativeCatalog.ts:8-11`.
**Apply to:** catalog reader, index, asset.json v2, sandbox ID input. Guard clauses with a plain-language `Error`, then trust types.

### Canonical JSON and hashing
**Source:** `scripts/native_assets_lib/gltf.py:20-21` `json_bytes`; `native_assets.hash_file`; TS `sha256` in `readAssetPackage.ts:27-30`.
**Apply to:** tree lock, `clientBuild`, fixture lock, dat inventory JSON.

### Hash-pinned external inputs
**Source:** `scripts/native_catalog/tables.py:18-29` (`SCHEMA_HASHES`, `CRYPTO_HASH`).
**Apply to:** inventory generator, guard, hashing script (record its own SHA-256).

### Python test skip for private inputs
**Source:** `tests/pipeline/test_native_presentations.py:157`.
**Apply to:** every pipeline test reading `E:` or the snapshot.

### Esbuild metafile import checks
**Source:** `tests/unit/editorScript.test.ts:12-27`.
**Apply to:** NOED-02, NOED-04, ARCH-02 boundary tests.

### Comment and size rules
Every file above that already exists contains comments (for example `GameWorldAdapter.ts:3-7,12`, `prepareSceneForReveal.ts:15,21,25-28`, `types.ts`, `tables.py:1-4`, `native_source_stage.py:114`, `editorScript.test.ts:1-2,9-11,29-32`). Touching a file removes all of them. Files over about 400 lines (`createNativeSliceRuntime.ts` 914, `DevSheet.ts` 734) are split when touched.

## No analog found

| File | Role | Data flow | Reason |
|---|---|---|---|
| `src/scene/openBabylonInspector.ts` | utility | event-driven | `@babylonjs/inspector` not installed; use RESEARCH Pattern 10 |
| `scripts/check_lane_ownership.*` | utility | transform | no lane tooling exists; prefix match of `<dir>/**` and exact paths from `.planning/lanes.json` |
| `STATUS.md`, `DECISIONS.md`, `.planning/lanes.json`, `docs/OUTPUT_CONTRACT.md` | docs | n/a | new process files; shapes in RESEARCH "Process files" |
| `scripts/generate_golden_fixtures.py` | utility | batch | only a TS in-memory ZIP fixture exists (`tests/fixtures/assetPackageFixture.ts`); port its ZIP_STORED layout |

## Metadata

**Analog search scope:** `src/scene`, `src/world`, `src/assets`, `src/runtime`, `src/ui/devSheet`, `scripts/`, `scripts/native_catalog`, `scripts/native_assets_lib`, `tests/unit`, `tests/pipeline`, `tests/fixtures`
**Files scanned:** 14 read directly, others via RESEARCH verified references
**Pattern extraction date:** 2026-11-08
