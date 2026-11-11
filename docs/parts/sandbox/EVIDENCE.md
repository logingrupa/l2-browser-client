# Offline sandbox evidence

Part `sandbox`, lane `data-ui`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

- SAND-01: the sandbox sheet on `/` spawns an NPC, equips an item and opens a window by ID on `NativeSliceAdapter`, and an ID without a converted asset shows the missing-asset marker with no stand-in (browser check `tests/browser/sandbox.spec.ts`). Cast by ID and the command rules are covered by the unit tests `tests/unit/sandboxCommands.test.ts`, `tests/unit/sandboxCommandSheet.test.ts`, `tests/unit/sandboxMissingAsset.test.ts`.
- INT-01 (sandbox half, plan 02-25): spawn, equip, cast and open window each note their key as converted (info tone), gap with the coverage row reason, or not in catalog with the index reason (warning tone), since 02-37 through the pickers' `outcomeOfLookup` and the window open outcome (`tests/unit/sandboxCoverageNotes.test.ts`). Browser check `NATIVE_STORE_ROOT=actors pnpm test:e2e tests/browser/sandbox-coverage-notes.spec.ts` passed 2026-11-09 15:15 Riga on actors lane catalog `7ab1cdcf`: npc:20001 converted, npc:20002 gap with its served coverage reason, npc:999999 not in catalog, and item 999999, skill 7 level 1 and StatusWnd matching the served files; screenshots `test-results/sandbox-coverage-notes/sandbox-coverage-notes-desktop.png` (1440 x 900) and `sandbox-coverage-notes-phone.png` (932 x 430 touch), no horizontal scroll at 430 x 932.
- SAND-02 sheet side (plan 02-35): five pickers behind `SandboxPickerHost` (`src/ui/devSheet/sandboxPickerHost.ts`), listed by `sandboxPickerSections` in the order tile, spawn, equip, cast, window (02-39 appends clips). They are built only from the existing sheet controls (id entry, select choice, button, note) with hover-card variables, never a toggle list, and they carry no styling. Every entry shows converted, gap or not in catalog with its reason from the catalog index. 02-37 implements the host (`src/runtime/sandboxRuntimeActions.ts`) and mounts the pickers on `/`.
  - Tile: `catalogIndex.keys("tile:")` with status, plus a typed `XX_YY` tile; `host.reloadTile` returns the outcome note. Variables `sandbox.tile.current`, `.selected`, `.lookup`, `.outcome`, `.walk` (walking is the existing tap-to-move on the loaded tile).
  - Spawn: NPC search over the `npcname_e_names` index (name substring, or an all-digit id), a raw NPC id, and a chargrp index bounded by the `table:chargrp` record count when that record is converted. Variables `sandbox.spawn.query`, `.selected`, `.nameIndex`, `.matchLimit`, `.lookup`, `.characterTemplateCount`.
  - Equip: item search over `itemname_e_names` or a raw item id, into the `upper` slot or the slot `equipmentSlotForBodyPart` builds from a typed body_part value, checked by `isEquipmentSlot` before dispatch. `sandbox.equip.slot` is `unverified` (02-41 slot form; body_part meaning undecoded).
  - Cast: skill search over `skillname_e_names` (one row per id and level) or a raw id and level, on the selected entity. Variables include `sandbox.cast.target`.
  - Window: `catalogIndex.keys("window:")` including `#<ordinal>` ids, plus a typed window id; `host.openWindow` is awaited and its outcome noted.
  - Name indexes: `readNativeTableNameIndex` reads the `<table>_names` tables record, checks byte length and SHA-256, validates `native-table-name-index` v1 and shares one fetch per table and signal. Matches are ordered by id, then level, then source order, and capped at `sandboxPickerMatchLimit` (12, a presentation choice). Equal names stay separate entries. An empty search shows a prompt and no list. A missing index shows the table status and leaves id entry working. An aborted read clears the matches.
  - Audio mute and volume for SAND-02 are the existing Audio section master mute and volume (`src/audio/worldAudioControls.ts`); no second audio control was added. 02-37 checks that section in the browser.
  - `DevSheet.ts` is split into `devSheetLayout.ts`, `devSheetDrag.ts`, `devSheetKeyboard.ts` and `devSheetTabs.ts` (330 lines, was 734), with no comments; `tests/unit/devSheet.test.ts` passes unchanged.
  - Tests: `tests/unit/devSheetPickers.test.ts`, `tests/unit/devSheetPickerActions.test.ts`, `tests/unit/readNativeTableNameIndex.test.ts`, `tests/unit/devSheetIdEntry.test.ts`, `tests/unit/devSheetSourceRules.test.ts` (every devSheet module under 400 lines, touched modules comment-free, picker and name-index modules free of stylesheets, style writes, styling classes, colours and fonts).
- ACT-04 clip picker (plan 02-39): the Clips group in the Sandbox section (`src/ui/devSheet/clipPicker.ts`, registered last in `sandboxPickerSections`) lists every actor the clip hub holds, in registration order, and the chosen actor's clips in package order. A click dispatches `play-clip` with the chosen entity id and the exact clip name through `SandboxPickerHost`, which now extends `ActorClipListingSource`; the runtime host answers listings from the runtime clip hub (`clipListings` option of `createSandboxRuntimeActions`). The group rereads the listings when it opens and from its "Reread clip listings" button. No loaded actor shows "No loaded actor has clips.", an actor without clips shows "<entity id> has no clips.", and neither dispatches. Each clip row's hover card shows `clip.name`, `clip.durationSeconds`, `clip.events` (normalized time, type, sound) and `clips.eventsWithoutClip` as native and `clips.previewing` as presentation. Clip names go in as text only. Tests: `tests/unit/clipPicker.test.ts` (dispatch, empty, ordering, late registration, shared clip names, markup names, hover card), `tests/unit/sandboxRuntimeActions.test.ts` (host listings equal the hub's). Browser check `NATIVE_STORE_ROOT=actors DEV_PORT=5175 pnpm test:e2e tests/browser/sandbox-npc-gremlin.spec.ts` on DATABASE-PC, 2026-11-10 01:22 to 01:33 Riga, actors lane store, ports 5173 and 5175 free: the npc:20001 picker case spawns the Gremlin on `/`, plays its first listed clip (`atk01`) from the picker, sees it as the active clip with no diagnostic and reads `clips.previewing` = `atk01` on the hover card at 1440 x 900; the 932 x 430 touch case plays it too; the 430 x 932 case has no horizontal scroll with the Clips section open; the 02-22 cases still pass. Screenshots `artifacts/npc-evidence/sandbox-clip-picker-npc-20001-1440x900.png` and `sandbox-clip-picker-npc-20001-932x430.png`. In the second full-file run the 430 x 932 case got "WebGPU is required" from the SwiftShader adapter on its sixth world load (6 passed, 1 failed); it passed in the first run and alone (`-g "Clips section open"`, 1 passed). Full `pnpm test:unit` after the code commits: 172 files passed, 4 skipped; 2,351 tests passed, 72 skipped, 0 failed.
- NOED-01 and NOED-03: every browser check opens `/` (the code-built native sandbox, `?world=interlude` before DEC-OWN-11) or a test harness page; no spec uses the `world` query parameter, `authored=1` or `public/scene`. A missing `/l2/catalog.json` shows "Native asset store not staged" (`tests/browser/nativeStartup.spec.ts`). Full `pnpm test:e2e` on DATABASE-PC after the native-world-slice merge (8ec3278), 2026-11-08 16:15 Riga, port 5173 free: 41 tests, 36 passed, 5 skipped, 0 failed, including the owner's orbit camera checks in `tests/browser/nativeCamera.spec.ts`. The 5 skips need local artifacts this machine does not have: three `assetPackage.spec.ts` cases (converted native packages), `nativeTexture.spec.ts` (migration coverage) and one `nativeBsp.spec.ts` case (Actor940 contact oracle).
- NOED-04: `?inspect=1` lazy-loads Babylon Inspector over the sandbox (`tests/browser/inspector.spec.ts`, plan 01-16).
- Private preview: the five preview scripts open `/` from `scripts/private-preview-targets.mjs`, pinned by `tests/unit/privatePreviewTargets.test.ts`. `preview:private` itself was not run. The burst check validates each section manifest path with `nativeSectionManifestPath` before reading it, and every dist read goes through one path check that refuses anything outside dist (211863f, `privatePreviewTargets.test.ts`); the burst check itself was not run.

## Dev cold start after the Editor pack left `pnpm dev`

Re-measured with `pnpm exec playwright test --config playwright.startup.config.ts` (`tests/startup/devStartup.spec.ts`, fresh Vite on 127.0.0.1:5175, one worker, trace on), route `?world=interlude` (now `/`), warm `.vite/deps` cache (browserHash `c9433f75` before both runs). The Vite log printed no "new dependencies optimized" line in either run.

PROMINENCE-PC, Ryzen 7 7800X3D, not comparable to the DATABASE-PC baseline.

| Run | Script requests | Script bytes | All requests | All bytes | First `src/runtime/` request | Longest completion gap | Ready | `babylonjs-editor-tools` requests |
|-----|-----------------|--------------|--------------|-----------|------------------------------|------------------------|-------|-----------------------------------|
| 1 | 630 | 13,648,199 | 930 | 134,324,765 | 0.551 s | 1.225 s | 10.234 s | 0 |
| 2 | 630 | 13,648,183 | 930 | 134,287,358 | 0.577 s | 0.822 s | 10.222 s | 0 |

Baseline (DATABASE-PC, route `?world=courtyard`, Editor pack in dev): 262 and 288 script requests, 7,537,124 and 8,748,728 bytes, first runtime module at 38.56 s and 39.25 s, longest gap 22.984 s and 21.528 s, Editor-tools closure 134 files.

Traces and JSON: `artifacts/dev-startup/prominence-run-1/` and `artifacts/dev-startup/prominence-run-2/` (`trace.zip`, `dev-startup-native-sandbox.json`).

DATABASE-PC, same machine as the baseline, 2026-11-08 14:25 Riga, same config and spec, two runs back to back:

| Run | Script requests | Script bytes | All requests | All bytes | First `src/runtime/` request | Longest completion gap | Ready | `babylonjs-editor-tools` requests |
|-----|-----------------|--------------|--------------|-----------|------------------------------|------------------------|-------|-----------------------------------|
| 1 | 633 | 13,542,594 | 929 | 133,516,754 | 6.116 s | 41.857 s | 64.635 s | 0 |
| 2 | 633 | 13,542,594 | 929 | 133,516,423 | 4.192 s | 8.939 s | 37.530 s | 0 |

Same machine, different route: the baseline route `?world=courtyard` is retired, so `?world=interlude` (which also loads about 133 MB of native assets) is the only comparable route. The wait before the first runtime module fell from about 39 s to 4 to 6 s, and no Editor tools are requested. The longest completion gap is not gone: 8.9 s on the second run, 41.9 s on the first. Its cause is not established; the first run's gap falls while the native assets load, which the courtyard baseline never did. Removing the Editor pack is not claimed to have fixed it.

## Open

- Dev cold start: the 41.9 s first-run completion gap on DATABASE-PC has no established cause (open observation, not a NOED-02 failure).
- UI-01: `interface.xdat` decoded to a layout tree, so native Interlude windows can replace the procedural HUD stand-in.
- The 5 e2e cases that skip on DATABASE-PC and PROMINENCE-PC run only where their artifacts exist.
- The headless SwiftShader WebGPU adapter refused a sixth world load in one run of `sandbox-npc-gremlin.spec.ts` ("WebGPU is required"); cause not established, the same case passes alone.

## Evidence

Adapter: `src/world/NativeSliceAdapter.ts`. Sandbox config: `src/runtime/nativeSandboxConfiguration.ts`.
