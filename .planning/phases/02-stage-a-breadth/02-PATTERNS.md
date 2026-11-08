# Phase 2: Stage A breadth - Pattern map

**Mapped:** 2026-11-08
**Basis:** 02-RESEARCH.md sections 4, 6 and 11 (11 wins over 6), 02-CONTEXT.md, AGENTS.md, PROJECT.md DEC-OWN-9/10
**Files analyzed:** 52 new or modified
**Analogs found:** 45 / 52

All analog paths below are git-tracked source in this worktree. Line numbers are fresh at `b0b0e6e` (RESEARCH pitfall 15: do not trust CONTEXT line numbers). Excerpts that contain comments or docstrings are shown as they exist today; AGENTS.md requires the executor to strip every comment in any touched file and never copy a comment into a new one.

## File classification

| New or modified file | Plan | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|---|
| `scripts/native_store/store_paths.py` | 02-01 | utility (trust boundary) | file-I/O guard | `scripts/native_batch.py:45-68` (`safe_relative`, `checked`, `child`) | exact (extract) |
| `scripts/native_assets.py` (bind guard) | 02-01, 02-09 | service | file-I/O | itself `:141-170` | modify |
| `scripts/native_catalog/cli.py` (`--output` guard) | 02-01 | CLI | file-I/O | `scripts/native_batch.py:108-121` (artifacts allowlist) | role |
| `tests/pipeline/test_store_paths.py` | 02-01 | test | - | `tests/pipeline/test_reference_client_guard.py:20-81` | exact |
| `scripts/native_store/unit_ledger.py` | 02-02 | service | batch | `scripts/native_batch.py:178-302` (owner/running/receipt/seal) | exact (generalise) |
| `scripts/check-machine-schedule.mjs` | 02-02 | utility CLI | request-response | `scripts/check-lane-ownership.mjs:133-154` | role |
| `tests/pipeline/test_unit_ledger.py` | 02-02 | test | - | `tests/pipeline/test_native_batch.py:1-40` | exact |
| `scripts/native_store/catalog_writer.py` | 02-03 | service | file-I/O | `scripts/stage_native_runtime.py:19-68, :273-339` | exact (extract) |
| `scripts/native_store/write_lane_catalog.py` | 02-03 | CLI | transform | `scripts/stage_native_runtime.py:273-350` | role |
| `scripts/stage_native_runtime.py`, `stage_native_world_audio.py` | 02-03 | CLI (kept, never run) | file-I/O | themselves | modify |
| `docs/OUTPUT_CONTRACT.md` | 02-01, 02-04, 02-08 | config/doc | - | itself | modify |
| `scripts/generate_golden_fixtures.py` + `fixtures.lock.json` | 02-04 | fixture generator | batch | itself | modify |
| `src/assets/native/readNativeCatalog.ts` | 02-05 | model/validator | request-response | itself `:12-57` | modify |
| `src/assets/native/nativeCatalogIndex.ts` | 02-05 | service | transform | itself `:5-96` | modify |
| `tests/unit/nativeCatalogIndex.test.ts` | 02-05 | test | - | itself `:1-40` | modify |
| `vite/nativeStoreRootPlugin.ts` | 02-06 | middleware (dev) | request-response | `vite.config.ts:17-40` (plugins) + `src/assets/native/nativeResourceUrl.ts` regex | role |
| `vite.config.ts` | 02-06 | config | - | itself | modify (strip `:1`) |
| `THIRD_PARTY_NOTICES.md` | 02-06 | doc | - | none | no analog |
| `tests/unit/nativeStoreRootPlugin.test.ts` | 02-06 | test | - | `tests/unit/nativeCatalogIndex.test.ts` (fetch stub style) | role |
| `scripts/native_store/build_coverage_report.py` | 02-07 | service | batch/transform | `scripts/build_dat_table_inventory.py:138-190` | exact |
| `docs/coverage.md` | 02-07 | doc | - | `docs/parts/data/EVIDENCE.md` | role |
| CONV tests (`tests/pipeline/test_conversion_contract.py`) | 02-08 | test (scan) | - | `tests/unit/architectureInvariants.test.ts:1-33`; `tests/pipeline/test_static_materials.py:178` | role |
| `src/world/worldTypes.ts` (+2 commands) | 02-44 | model | event-driven | itself `:47-59` | modify |
| `src/world/MockWorldAdapter.ts`, `NativeSliceAdapter.ts` (exhaustive `never`) | 02-44 | service | event-driven | `MockWorldAdapter.ts:52-116` | modify |
| `tests/unit/gameWorldAdapterContract.test.ts` | 02-44 | test | - | itself | modify |
| `scripts/world/freeze_world_oracle.py` | 02-13 | CLI | transform (read-only) | `scripts/build_dat_table_inventory.py:157-190` | role |
| `scripts/world/tile_census.py` -> `docs/parts/world/tile-census.json` | 02-13, 02-50 | CLI | batch (header-only) | `scripts/build_dat_table_inventory.py` | exact |
| `scripts/native_map.py` split + optional section box | 02-14 | service | file-I/O | itself `:244-410` | modify |
| `scripts/world/raw_map_step.py` | 02-14 | CLI step | batch | `scripts/native_map.py:435-512` (`migrate_map`, `main`) | exact |
| `scripts/world/tile_chunk_plan.py` | 02-15 | service | transform | `scripts/native_map_geometry.py` `select_terrain_sectors :196-245` | role |
| `scripts/native_map_geometry.py` split | 02-15 | service | transform | itself | modify |
| `src/scene/world/loadNativeTileChunk.ts` (+parser) | 02-16 | loader/validator | streaming | `src/scene/world/loadNativeSection.ts:60-110` | exact |
| `tests/browser/worldTileWalk.spec.ts` | 02-16 | e2e | - | `tests/browser/nativeSection.spec.ts:1-40` | exact |
| `scripts/data/convert_tables.py` | 02-10, 02-20 | CLI | batch | `scripts/native_catalog/tables.py:198-241` + ledger | role |
| `scripts/native_catalog/table_pins.py` | 02-10 | config | - | `scripts/native_catalog/tables.py:12-45` | exact (extract) |
| `scripts/native_catalog/tables.py` (generic resolver, real source) | 02-10 | service | transform | itself `:176-241`; `build_dat_table_inventory.py:61-75` (case-insensitive) | modify |
| `tests/pipeline/test_dat_table_inventory.py` | 02-10 | test | - | itself `:100-106` | modify |
| `scripts/data/elbera_hair_tables.py` | 02-21 | adapter | file-I/O | `tests/pipeline/test_native_batch.py:20-28` (`spec_from_file_location`) | role |
| `scripts/ui/interface_layout_tree.py` (pinned `parse_xdat`) | 02-11 | adapter | transform | same `spec_from_file_location` pattern | role |
| `scripts/data/texture_package_census.py` -> `docs/parts/ui/texture-package-census.json` | 02-45 | CLI | batch (header-only) | `build_dat_table_inventory.py` | exact |
| `src/ui/nativeWindows/*` (DOM renderer, anchors) | 02-12, 02-23 | component | request-response | `src/ui/EntityLabel.ts`, `src/ui/devSheet/*` (DOM only) | partial |
| `tests/unit/nativeWindowSkinScan.test.ts` | 02-23 | test (scan) | - | `tests/unit/architectureInvariants.test.ts:1-21` | exact |
| `tests/browser/native-window-layout.spec.ts` | 02-12, 02-23 | e2e | - | `tests/browser/nativeSection.spec.ts` | role |
| `scripts/actors/ukx_header_census.py`, `unit_inventory.py` | 02-17 | CLI | batch | `build_dat_table_inventory.py`; `native_catalog/cli.py:85-92` `inspect_header` | exact |
| `scripts/actors/npc_request_generator.py` | 02-18 | service | transform | `scripts/native_actor_profiles.py` | role |
| `tests/browser/support/loadCheckRecords.ts` + `load-sweep-*.spec.ts` | 02-46 | test support | file-I/O | `tests/browser/nativeSection.spec.ts:1-12` (catalog read), `assetPackage.spec.ts:148` (JSON report) | role |
| `scripts/native_store/merge_lane_store.py` | 02-47 | CLI | file-I/O | `scripts/stage_native_runtime.py:327-339` (verify before copy) | exact |
| `scripts/world/mover_step.py` | 02-49 | CLI step | transform | `scripts/native_map_movers.py:26-34, :183` | role |
| `src/scene/navigation/meshNavigation.ts` (cells) | 02-29 | service | event-driven | itself `:17-23, :142, :213, :228` | modify |
| `src/ui/devSheet/*` split + pickers | 02-22 | component | event-driven | `src/ui/devSheet/types.ts:5-23`, `DevSheet.ts:318` | modify |
| `package.json` `convert:*`, `report:coverage` | 02-07, 02-19 | config | - | existing `"assets:convert"` | modify |

## Pattern assignments

### `scripts/native_store/store_paths.py` (utility, file-I/O guard) - 02-01

**Analog:** `scripts/native_batch.py`. Move, do not copy: delete `checked`/`child` here and the twin in `scripts/stage_native_players.py:61-84`, then import from the new module.

Portable relative path check (`native_batch.py:45-51`):
```python
def safe_relative(value):
    require(isinstance(value, str) and value and '\\' not in value, 'Expected portable relative path')
    for part in value.split('/'):
        require(part and part not in ('.', '..') and not re.search(r'[:\x00-\x1f]', part)
                and not part.endswith(('.', ' ')) and not re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I),
                'Unsafe relative path: ' + value)
    return value
```

Reparse refusal on the unresolved ancestors, then resolve (`:54-68`):
```python
def checked(path):
    path = Path(path).absolute()
    for parent in (path, *path.parents):
        if parent.exists() or parent.is_symlink():
            info = parent.lstat()
            require(not stat.S_ISLNK(info.st_mode) and not (getattr(info, 'st_file_attributes', 0) & 0x400),
                    'Symlink/junction/reparse boundary refused: ' + str(parent))
    return path.resolve()

def child(root, relative):
    root = checked(root)
    path = checked(root / safe_relative(relative))
    require(path.is_relative_to(root) and path != root, 'Path escapes declared root')
    return path
```

Artifacts allowlist (`native_batch.py:119-121`):
```python
    output = checked(output)
    artifacts = checked(project_root / 'artifacts')
    require(output.is_relative_to(artifacts) and output != artifacts, 'Batch output must be a dedicated artifacts subdirectory')
```

New pieces with no analog: `require_converter_output` must also compare against `os.path.realpath(project_root / 'public/l2')` and refuse anything at or under it (the junction is why `Converter.__init__`'s `Path(output).resolve()` at `native_assets.py:143` is unsafe). `lane_store_root(project_root, lane_name)` validates `lane_name` against the keys of `lanes.json` (read via the same JSON loader as `check-lane-ownership.mjs`; confirm key spelling, RESEARCH 4.3 INF). Rename on extraction: `checked` -> `refuse_reparse_points`, `child` -> `confined_child_path`, `require` -> `require_condition` (full-word names).

**Binding sites** (`native_assets.py:141-150`):
```python
class Converter:
    def __init__(self, client, output, umodel):
        self.client, self.output, self.umodel = Path(client).resolve(), Path(output).resolve(), Path(umodel).resolve()
        self.reference_client = require_reference_client(self.client)
        if self.output.is_relative_to(self.client):
            raise ValueError('Output must be outside the read-only source client')
```
Insert `require_converter_output(ROOT, output)` before `Path(output).resolve()`. Same at `native_catalog/cli.py --output` and `native_batch.prepare`.

**Test analog:** `tests/pipeline/test_reference_client_guard.py:20-81` - `write_tree_file` helper, `tempfile.TemporaryDirectory()` + `addCleanup`, a loop of refused cases with `assertRaises`. Junction creation via `_winapi.CreateJunction`, `self.skipTest(reason)` when unavailable. Scan test (every new `scripts/<lane>/` entry calls the guard) follows `architectureInvariants.test.ts` style but in Python over `Path('scripts').rglob('*.py')`.

---

### `scripts/native_store/unit_ledger.py` (service, batch) - 02-02

**Analog:** `scripts/native_batch.py:178-302`. Copy the lifecycle shape, not the all-or-nothing policy.

Canonical bytes and digest (`:32-42`):
```python
def canonical(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=True) + '\n').encode()

def digest(data):
    return hashlib.sha256(data).hexdigest()
```

Exclusive writes (`:84-87`):
```python
def write_new(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as stream:
        stream.write(canonical(value))
```

Running marker, receipt, seal (`:237-238, :295-302`):
```python
    write_new(output / 'owner.json', owner)
    write_new(output / '.running.json', {'pid': os.getpid(), 'ownerSha256': digest(canonical(owner))})
    ...
        write_new(output / 'batch.json', receipt)
        write_new(output / 'complete.json', {'schemaVersion': 1, 'ownerSha256': digest(canonical(owner)),
                                           'batchSha256': file_hash(output / 'batch.json')})
    ...
        (output / '.running.json').unlink()
```

Seal verification (`:178-186`):
```python
def verify_batch(output, owner=None):
    output = checked(output)
    require(not (output / '.running.json').exists(), 'Batch is active/interrupted; retained output is not a completed cache')
    recorded = load_json(output / 'owner.json')
    if owner is not None:
        require(recorded == owner, 'Batch inputs/settings/implementation changed; use a fresh output')
    receipt = load_json(output / 'batch.json')
    seal = load_json(output / 'complete.json')
```

Deviations required by RESEARCH 4.4: layout per unit `work/<unit>/<step>/{owner.json,.running.json,receipt.json,complete.json}`; a `.running.json` without a seal is cleared and redone (not refused); fingerprint = lock `eSha256` of inputs + step `algorithmVersion` + config, never `file_hash(Path(__file__))` (the `orchestratorSha256`/`collectorSha256` fields at `:136, :155` are exactly what must not be copied); never call `verify_lock` (`:90-105` re-hashes every file). Lock SHA comes from `read_reference_client_lock` (`reference_client_guard.py:35-50`) `record['eSha256']`.

Preflight: relay-window check by `subprocess.run(['node', 'scripts/check-machine-schedule.mjs'])` (Python has no tz database, 11.18); free disk via `shutil.disk_usage(lane_store_root)`, value and Riga time written into the receipt; BelowNormal via `psutil` is not installed, so use `subprocess` `creationflags=BELOW_NORMAL_PRIORITY_CLASS` on child processes.

Gap row schema: `{key, part, step, status, reason, sourceIdentity, evidence}`, closed versioned reason tuple as a module constant (style of `TABLES` in `native_catalog/tables.py:27`).

**Test analog:** `tests/pipeline/test_native_batch.py:1-40` - load subject by `importlib.util.spec_from_file_location` with fake adapters, `snapshot(root)` of bytes and mtimes to prove "no rewrite on sealed rerun". Inject clock and disk as parameters (same idea as `execute=subprocess.run` at `native_batch.py:215`).

---

### `scripts/check-machine-schedule.mjs` (utility CLI) - 02-02

**Analog:** `scripts/check-lane-ownership.mjs:133-154`. Copy the entry guard and exit-code shape:
```js
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runLaneOwnershipCheck();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
```
Export the pure window function (`isInsideRelayWindow(date)`) for a Vitest with fixed dates; compute Riga wall time with `Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Riga", weekday, hour, minute })`. A `.d.mts` sibling exists for the lane check (`scripts/check-lane-ownership.d.mts`); add one if the Vitest imports it.

---

### `scripts/native_store/catalog_writer.py` (service, file-I/O) - 02-03

**Analog:** `scripts/stage_native_runtime.py`. Extract these functions verbatim (minus comments/docstrings), then make `stage_runtime` import them.

Atomic replace and immutable write (`:40-59`):
```python
def replace_file(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + '.', suffix='.tmp', delete=False) as output:
        temporary = Path(output.name)
        output.write(payload)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    if hash_file(path) != digest(payload):
        raise ValueError('Runtime copy hash differs: ' + str(path))

def immutable_write(path, payload):
    if path.exists():
        if hash_file(path) != digest(payload):
            raise ValueError('Existing immutable runtime asset is corrupt; preserved: ' + str(path))
        return
    replace_file(path, payload)
```

File set with case collision refusal (`:62-67`):
```python
def add_file(files, relative, payload):
    safe_name(relative)
    key = relative.casefold()
    if key in files and files[key] != (relative, payload):
        raise ValueError('Conflicting runtime resource paths: ' + relative)
    files[key] = (relative, payload)
```

Verify every destination, then write, then catalog last (`:327-335`):
```python
    for relative, payload in files.values():
        path = contained(destination, relative)
        if path.exists() and hash_file(path) != digest(payload):
            raise ValueError('Existing immutable runtime asset is corrupt; preserved: ' + str(path))
    catalog_path = contained(destination, 'catalog.json')
    for relative, payload in files.values():
        immutable_write(contained(destination, relative), payload)
    destination.mkdir(parents=True, exist_ok=True)
    replace_file(catalog_path, json_bytes(catalog))
```

Record shape to keep (`:269-270`): `{'id', 'manifest': '/l2/' + prefix + 'manifest.json', 'manifestSha256', 'manifestBytes'}`. Store prefixes stay as today (RESEARCH 4.2): `<archiveSha>/asset.l2asset` (`:304-318`), `maps/<sha>/...`, `npc-profiles/<sha>/` (`:264`); new kinds only add `tables/`, `windows/`, `tiles/`.

The hard `public/l2` guard (`:274-276`) stays in `stage_runtime`; `write_store(store_root, ...)` takes the root as a parameter validated by `store_paths.require_converter_output`. `contained` (`:19-24`) must use the new reparse-safe check instead of `resolve()`.

`write_lane_catalog.py`: CLI shape from `stage_native_runtime.py:342-350` (`argparse`, `print(json.dumps(...))`); adds `sourceCatalogSha256` and a `--plan` mode that only prints commands (mode split pattern from `native_batch.py:307-322`, `--plan`/`--verify-only` mutually exclusive group). Byte-identical-twice test: `canonical` / `json_bytes` + `snapshot()` from `test_native_batch.py`.

`merge_lane_store.py` (02-47) reuses the same verify-then-copy block and adds refusals for duplicate ids and a mismatched base `sourceCatalogSha256`.

---

### `src/assets/native/readNativeCatalog.ts` (validator) - 02-05

**Analog:** itself. New slices `tables`, `windows`, `tiles`, `coverage` go into the interface (`:12-24`) and `validateNativeCatalog` (`:47-57`), because unknown keys are dropped silently:
```ts
type OptionalCatalogSliceName = Exclude<keyof NativeCatalog, "schemaVersion" | "models">;

function optionalCatalogSlice(catalog: Record<string, unknown>, name: OptionalCatalogSliceName): readonly unknown[] {
  const slice = catalog[name];
  if (slice === undefined) return [];
  if (!Array.isArray(slice)) throw invalidCatalog();
  return slice;
}
```
Add `sourceCatalogSha256` as an optional string with a 64-hex guard in the same function.

### `src/assets/native/nativeCatalogIndex.ts` (service, transform) - 02-05

**Analog:** itself. Extend the lookup union (`:13-15`) with a `gap` member `{ status: "gap"; key; reason }`; replace the fixed `windowsNotConvertedReason` (`:26`) with entries built from the `windows` slice; derive `tile:` from the `tiles` slice instead of `sectionTilePattern` (`:25`) once the old section kind retires. Keep the duplicate-refusal helper (`:81-84`):
```ts
  const addEntry = (lookup: NativeCatalogLookup) => {
    if (entries.has(lookup.key)) throw duplicateEntries(lookup.key);
    entries.set(lookup.key, lookup);
  };
```
Record validation uses `catalogRecordIdentity` (`:59-64`). NPC join switches from mesh `source.object` match (`:87-96`) to model catalog id (02-35; RESEARCH 5.2 reconciliation). Key builders (`:33-53`) already exist for `window:` and `tile:`; add `tableCatalogKey` and `characterCatalogKey` in the same shape (`requireCatalogInteger`, pattern guard).

**Test analog:** `tests/unit/nativeCatalogIndex.test.ts:9-40` - `catalogWith(slices)` builder, `serveFiles` fetch stub via `vi.stubGlobal`, `sha256` from `readAssetPackage`. Update `catalogWith` defaults with the new slices.

---

### `vite/nativeStoreRootPlugin.ts` (dev middleware) - 02-06

**Analog:** the plugin factory shape in `vite.config.ts` (a function returning a Vite `Plugin` with `name`, `apply` and a `configResolved` hook; the old external-media build plugin is deleted by the self-contained repo merge, so read the merged `vite.config.ts` for the current factory). Use `apply: "serve"` and `configureServer(server) { server.middlewares.use(...) }` (hook shape at `:20-25`). Read `NATIVE_STORE_ROOT` through `loadEnv(mode, process.cwd(), "")` exactly as `:45`. Request path guard: copy the regex from `src/assets/native/nativeResourceUrl.ts:6`
```ts
/^\/l2\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/
```
and add an agreement Vitest that feeds the same cases to both. Root check: `realpathSync(root)` under `<project>/artifacts/lane-store/<lane>/l2` and not equal to or under `realpathSync("public/l2")`. Overlay: `catalog.json` (and `coverage.json`) only from the lane root; other paths fall back to `public/l2` read-only. `vite.config.ts:1` licence comment moves to `THIRD_PARTY_NOTICES.md`; strip it.

Vitest analog for `buildExcludedPublicPaths` style: `vite.config.ts` already exports pure helpers (`isBuildExcludedPublicPath :12-15`) for testing; export the plugin's pure path resolver the same way.

---

### `scripts/native_store/build_coverage_report.py` (batch/transform) - 02-07

**Analog:** `scripts/build_dat_table_inventory.py` - validator + bytes writer + main split:
- `validate_dat_table_inventory(inventory)` `:138` -> `validate_coverage_report`
- `build_dat_table_inventory(client_access, lock, ...)` `:157` -> `build_coverage_report(inventory, lock, census, load_check_records)`
- `dat_table_inventory_bytes(inventory)` `:177` -> `coverage_report_bytes`
- `main(argv=None)` `:181`

Denominators only from `docs/parts/data/dat-table-inventory.json`, `recipes/reference-client-tree.lock.json` (`maps/\d{2}_\d{2}.unr`), committed census JSONs; the literal `"unknown"` passes through. Errors raise a module-specific `ValueError` subclass (`DatTableInventoryError` pattern; also `ReferenceClientLockError` at `reference_client_guard.py:16-17`). 02-48 adds the per-row completeness test on top.

---

### CONV-01/02 contract tests - 02-08

**Analogs:** `tests/unit/architectureInvariants.test.ts:1-21` (scan modules, `expect(list).toEqual([])`); `tests/pipeline/test_static_materials.py:178` (magenta assertion); `tests/pipeline/test_native_assets.py:123` (UModel patched). Constants to assert: `UMODEL_SHA256` (`native_assets.py:32`), `MAX_ARCHIVE`/`MAX_PAYLOAD` (`:34-35`), refusal at `:147-148`. Python scan over `scripts/**/*.py` bans normalisation/ground-fit/root-drift/renormalise tokens, allow-list `native_assets_lib/weights.py` `restore_native_weights` and `audit_musveren_weights.py`.

---

### `src/world/worldTypes.ts` + adapters (event-driven) - 02-44

Add exactly two members to `WorldCommand` (`worldTypes.ts:47-59`), same one-line union style:
```ts
  | { readonly type: "spawn-npc"; readonly npcId: number }
```
-> `{ readonly type: "spawn-character"; readonly characterTemplateIndex: number }` and `{ readonly type: "play-clip"; readonly entityId: string; readonly clipName: string }`.
`MockWorldAdapter.dispatch` switch (`:52-116`) has no `default`; add `default: { const unhandledCommand: never = command; throw new Error(...) }` in both adapters. Contract test (`gameWorldAdapterContract.test.ts:12-20`) gains an `expectTypeOf<WorldCommand["type"]>().toEqualTypeOf<...>()` enumerating the set. `EquipmentSlot = "upper"` (`:11`) widens only in 02-38 from decoded `body_part` meanings.

---

### World lane steps (`scripts/world/*.py`) - 02-13..02-16, 02-25..02-30, 02-49, 02-50

**Analogs:**
- Census writers (`tile_census.py`, `freeze_world_oracle.py`): `build_dat_table_inventory.py` structure (above) and its lock reader `reference_side_dat_file_names(lock)` `:87-96`; header reads via `native_catalog/cli.py:85-92` `inspect_header` behind `require_reference_client(client).require_equal_file(relative)` (`reference_client_guard.py:59-66`).
- `raw_map_step.py`: wraps `build_map(client, recipe, write)` (`native_map.py:293`); recipe validation at `validate_recipe` `:244` (section box mandatory today at `:248-255`, make optional during the split); writer callback pattern from `migrate_map` `:435-487` (`def write(relative, data)` at `:464`). Source access through `MapSources` `:258-287`.
- `tile_chunk_plan.py`: `select_terrain_sectors` (`native_map_geometry.py:196-245`); mask UV `qualified_mask_uv_rule` `:312-340` is 20_20-only, so other tiles carry the `extrapolated` label, never a pass.
- `mover_step.py`: generalise `native_map_movers.py:26-34` hand list into every `Engine.Mover` export; gap reason `mover-unsupported:<reason>`.
- Every step registers with `unit_ledger` and writes only under `store_paths.lane_store_root(ROOT, 'world')`.

Split rule (pitfall 10): `native_map.py` 512 and `native_map_geometry.py` 1,043 lines get split by concern when touched; new logic only in new modules.

**Pipeline test analog:** `tests/pipeline/test_native_map.py`, `test_native_map_geometry.py` (synthetic packages); real-client run skips with `self.skipTest` when `E:/Lineage2-client` is absent. Note test discovery (`scripts/test_pipeline.py:21-22`) covers only `tests/pipeline` and `scripts/native_catalog`; tests for `scripts/world` etc. must live in `tests/pipeline`.

### `src/scene/world/loadNativeTileChunk.ts` (loader/validator, streaming) - 02-16

**Analog:** `src/scene/world/loadNativeSection.ts:60-110`. Copy the guard-clause parser style for the new kind `native-tile-chunk-runtime` v1:
```ts
function resource(value: unknown, expression: RegExp): value is Resource {
  return object(value) && typeof value.file === "string" && expression.test(value.file) &&
    typeof value.sha256 === "string" && HASH.test(value.sha256) && typeof value.bytes === "number" &&
    Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= 128 * 1024 * 1024;
}

export function parseNativeSection(input: unknown): NativeSectionManifest {
  if (!object(input) || input.schemaVersion !== 1 || input.kind !== "native-map-section-runtime" || ...
```
Differences: zero models allowed (old parser rejects `< 1` at `:71`), no `sourceModel === "20_20.Model798"` pin (`:99`), separate collision resource, `gaps` list kept as data. Keep the old parser until the 20_20 chain retires. A preview failure must become a gap row (pitfall 7, `loadNativeSection.ts:278-285` swallows today). Navigation: `createWorldNavigation(options)` (`src/scene/navigation/meshNavigation.ts:142`) with terrain passed at construction; 02-29 adds cell add/remove driving the existing `isReady` option (`:23`, consulted at `:213, :228`).

**E2E analog:** `tests/browser/nativeSection.spec.ts:1-40` - reads `catalog.json` by `readFileSync`, skips when not staged, verifies bytes/SHA with `createHash`. For lane stores, read from `artifacts/lane-store/<lane>/l2/catalog.json` instead of `public/l2`. Snapshot and dispatch via `window.__nativeSlice` (`nativeSlice.spec.ts:10-11`). Config: `playwright.config.ts` uses `DEV_PORT || 5173`, `reuseExistingServer: false`, `workers: 1`.

---

### Data lane - 02-10, 02-20, 02-21

`scripts/native_catalog/table_pins.py`: move `SCHEMA_HASHES`, `MTX_DEFINITION_EVIDENCE`, `RGBA_DEFINITION_EVIDENCE` and `TABLES` out of `tables.py:12-45` and add the 29 layouts. Pin check helper stays (`checked_bytes`, `tables.py:48-52`).

`tables.py` changes, all inside `table_source_path` (`:176-195`) and `decode_table` (`:198-241`):
- generic case-insensitive resolver shared with the inventory's matcher (`build_dat_table_inventory.py:61-64`):
```python
    matched_layouts = [layout for pattern, layout in links if re.fullmatch(pattern, file_name, re.IGNORECASE)]
    if len(matched_layouts) > 1:
        raise DatTableInventoryError(f'descriptor matches more than one layout for {file_name}: {matched_layouts}')
```
- the hard-coded `source` (`:234`, `'system/' + name + '.dat'`) becomes `path.relative_to(client).as_posix()` for all tables;
- uniqueness rule (`:222-226`) becomes data-driven from a per-layout key map, never invented keys;
- `UnicodeDecodeError` from `ue2.py:71-78` caught next to `FormatError` and written as a `decode-failed:<error>` gap row.

`scripts/data/convert_tables.py`: one ledger unit per table, writes `tables/<sha>/` under the data-ui lane root, never calls `native_catalog/cli.py main` (whole-tree `inventory()`).

Elbera adapters (`elbera_hair_tables.py`, `interface_layout_tree.py`): load by pinned path + SHA with `sys.dont_write_bytecode = True` and
```python
SPEC = importlib.util.spec_from_file_location('_native_batch_lifecycle_test_subject', ROOT / 'scripts/native_batch.py')
batch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(batch)
```
(`tests/pipeline/test_native_batch.py:22-27`); verify the file SHA with `sha256_of_file` (`reference_client_guard.py:30-32`) before `exec_module`. Never call `verify`, `--check`, `--emit`, `--stage`.

Test tallies: `tests/pipeline/test_dat_table_inventory.py:100-106` (`local-layout-only == 29`) is updated in the same commit as the inventory.

---

### UI lane - 02-11, 02-12, 02-23, 02-45

- `src/ui/nativeWindows/**`: no existing native-window renderer (no analog). DOM creation style: `src/ui/EntityLabel.ts`, `src/ui/LoadingScreen.ts`. Values come only from the 02-11 tree and converted UI textures served as `/l2/...` via `nativeResourceUrl`; no colour literals, `font-family` or non-`/l2/` images (DEC-OWN-10). HP from `WorldEntity.health`/`maximumHealth` (`worldTypes.ts:19-20`); CP and MP rendered as `adapter-field-absent` gaps.
- Skin scan test: copy `tests/unit/architectureInvariants.test.ts:1-21` using `listTypeScriptModules("src/ui/nativeWindows")` from `tests/support/sourceImportSpecifiers`, but scan file text for the forbidden tokens.
- Playwright: viewports per DEC-OWN-9 - 932 x 430 landscape with `isMobile: true, hasTouch: true`, 430 x 932 portrait no-scroll check, 1440 x 900 desktop. RESEARCH 6 lists 844x390; 11.15 and PROJECT.md win.
- `texture_package_census.py` (02-45): same writer shape as `build_dat_table_inventory.py`, header-only via `inspect_header`.

### Sandbox - 02-22

`src/ui/devSheet/DevSheet.ts` (734 lines) splits by concern under 400 lines and loses all comments (comment counts in RESEARCH 5.4). Reuse `VariableInfo`/`DevVariableStatus` (`src/ui/devSheet/types.ts:5-23`) and `describe(element, info)` (`DevSheet.ts:318`) for every picker hover card. Wiring in `src/runtime/attachNativeSliceSheet.ts:251-257` goes in 02-22b (integration). Test analog: `tests/unit/devSheet.test.ts:35-82` (describe/it per behaviour, open, close, pin).

### Actors lane - 02-17, 02-18, 02-34..02-42

- Census and unit inventory: `build_dat_table_inventory.py` writer shape; rows from `decode_table` (`tables.py:198`); headers via `inspect_header` (`native_catalog/cli.py:85-92`) behind the guard.
- Request generator: one `Converter` per batch (its `__init__` walks the client with `rglob`, `native_assets.py:151-153`); profile raises in `native_actor_profiles.py` become gap rows; caps `MAX_CLASSES = 96` (`native_effect_bundle.py:29`), 16x128 profiles (`loadNativeNpcProfiles.ts:36,54`) are lifted only in 02-35.
- 02-09 cost fix in `Converter.source` (`native_assets.py:161-171`): replace `digest = hash_file(path)` with the lock `eSha256` when the guard's stat check matched (the guard already does stat-first at `reference_client_guard.py:79-81`):
```python
        if (status.st_size, status.st_mtime_ns) == (record['eBytes'], record['eModifiedNanoseconds']):
            return
        if sha256_of_file(path) != record['eSha256']:
```
Expose the record from `ReferenceClientAccess` instead of re-hashing.

---

### `tests/browser/support/loadCheckRecords.ts` - 02-46

**Analog:** `tests/browser/nativeSection.spec.ts:1-12` (catalog read and `createHash` SHA), `assetPackage.spec.ts:148` (JSON report write with `mkdir`/`writeFile` from `node:fs/promises`). Write each key's `{key, status, reason, atRiga}` atomically (temp file + rename, same rule as `replace_file`). Records live at `artifacts/lane-store/<lane>/load-checks/<catalogSha256>.json`. Relay-window check through Playwright `globalSetup` calling `check-machine-schedule.mjs`.

## Shared patterns

### Trust-boundary guard clauses
**Source:** `scripts/reference_client_guard.py:20-27, :59-81`; `src/assets/native/readNativeCatalog.ts:47-50`.
**Apply to:** every converter step, catalog reader, chunk parser, dev plugin.
Every E: read goes through `require_reference_client(client).require_equal_file(relative_path)`. Decoded input is checked with explicit guards and a specific error class (`ReferenceClientLockError`, `FormatError`, `invalidCatalog()`); no tolerances.

### Output confinement
**Source:** new `store_paths.py` (from `native_batch.py:54-68, :119-121`).
**Apply to:** `Converter`, `native_catalog/cli.py`, `native_batch`, all `scripts/<lane>/*`, `catalog_writer.write_store`, `merge_lane_store`. Output only under `artifacts/lane-store/<lane>/l2/`; `public/l2` realpath refused.

### Hash-addressed immutable writes
**Source:** `stage_native_runtime.py:40-67, :327-335`. Verify all destinations, then write, catalog last.

### Canonical JSON
**Source:** `native_batch.py:32-33` `canonical`; `native_assets_lib/gltf.json_bytes`. Pick one per output kind and keep it; byte-identical reruns are tested.

### Gap rows instead of raises at unit level
**Source:** `native_batch.py:285-287` (per-job `failed` row instead of aborting the batch). Unit failures become `{key, part, step, status, reason, sourceIdentity, evidence}` rows from the closed reason list in `unit_ledger.py`.

### Vitest structure
**Source:** `tests/unit/nativeCatalogIndex.test.ts:1-40`, `tests/unit/gameWorldAdapterContract.test.ts`. Import from `../../src/...`, `vi.stubGlobal("fetch", ...)`, builders like `catalogWith`, `expectTypeOf` for contracts.

### Pipeline test structure
**Source:** `tests/pipeline/test_reference_client_guard.py:1-81`, `tests/pipeline/test_native_batch.py:1-40`. `unittest.TestCase`, `sys.path.insert(0, str(ROOT / 'scripts'))`, temp trees, `snapshot()` for no-write proofs, skip with reason on missing E: or junction support. Must live under `tests/pipeline` to be discovered.

### Ownership check
**Source:** `scripts/check-lane-ownership.mjs:133-145`. Run `node scripts/check-lane-ownership.mjs --base <plan start> --part <slug>` after the last code commit and before the docs commit (`.planning/**` is integration-owned).

### Code rules applied to every touched file
No comments (strip the whole file, incl. docstrings like `native_batch.py:1-4`, `stage_native_runtime.py:1, :20, :41` and `nativeResourceUrl.ts:1-4`, `types.ts:1-24`); full-word names; under about 400 lines; no dead code (the moved `checked`/`child` copies are deleted, not left).

## No analog found

| File | Role | Data flow | Reason |
|---|---|---|---|
| `src/ui/nativeWindows/*` renderer and anchor resolver | component | request-response | no xdat-driven DOM renderer exists; use RESEARCH 5.4 and DEC-OWN-10 |
| `scripts/ui/interface_layout_tree.py` tail hashing and window-id duplicate rule | adapter | transform | Elbera `parse_xdat` is external; only the pinned-import pattern is local |
| `vite/nativeStoreRootPlugin.ts` overlay + Range handling | middleware | request-response | no `/l2` middleware exists; only plugin skeletons |
| `meshNavigation.ts` cell add/remove | service | event-driven | navigation appends obstacles only today |
| WORLD-04 ring calculator and `addLODLevel(distance, null)` | service | streaming | no LOD in `src/` (11.9); radius load/dispose in `loadImportedWorld.ts:24, :111-133` is the nearest |
| `THIRD_PARTY_NOTICES.md` | doc | - | new file |
| WORLD-07 review fixtures `tests/fixtures/world-07/` | fixture | - | copied from the main-checkout packet, read-only source (11.14) |

## Metadata

**Analog search scope:** `scripts/`, `scripts/native_catalog/`, `src/assets/native/`, `src/scene/`, `src/world/`, `src/ui/`, `tests/unit/`, `tests/pipeline/`, `tests/browser/`, `vite.config.ts`, `playwright.config.ts`.
**Files scanned:** about 30 read, 250 listed.
**Pattern extraction date:** 2026-11-08
