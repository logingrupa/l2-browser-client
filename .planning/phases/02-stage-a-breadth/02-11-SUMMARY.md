---
phase: 02-stage-a-breadth
plan: 11
subsystem: world-review
status: complete
tags: [world-07, terrain-layer-order, music-volume-join, fixtures, independent-review, pol-01]
requires:
  - phase: 01-foundations
    provides: "reference_client_guard.sha256_of_file and the tests/pipeline discovery in scripts/test_pipeline.py (plan 01-17 wave)"
provides:
  - "scripts/world/ package with copy_world07_fixtures.py: verify_world07_packet_manifest, drop_absolute_path_fields, find_long_binary_runs, find_absolute_path_text, copy_world07_fixtures, World07PacketManifestError, World07FixtureCopyError, WORLD07_FIXTURE_SOURCES"
  - "tests/fixtures/world-07/: fixtures.json (packet manifest SHA-256 08ff99a8...), discriminating-cases.json, browser-test-cases.md, music-id-join.json"
  - "docs/parts/world/EVIDENCE.md section 'WORLD-07 review': reviewer identity, 74/74 re-hash, unchanged listing digest, 47 findings with one verdict each"
affects: [02-15 terrain layer ordering, 02-45 per-tile music join, POL-01]
actuals:
  tokens: 24100
  tasks: 3
  commits: 4
plan_head_before: 2a806d92c21f9273c1ab55d85e6ff3a9bb56670a
plan_head_after: 97cc2bcfafc1cf576372f9e11844d3bbc64fb9f1
tech-stack:
  added: []
  patterns:
    - "Packet evidence enters the repo only through a manifest re-hash, then a path-free copy into a staging directory beside the destination, renamed into place"
    - "Absolute path fields are dropped and recorded as JSON pointers; the final path segment stays as a sibling <key>Basename field"
key-files:
  created:
    - scripts/world/__init__.py
    - scripts/world/copy_world07_fixtures.py
    - tests/fixtures/world-07/fixtures.json
    - tests/fixtures/world-07/discriminating-cases.json
    - tests/fixtures/world-07/browser-test-cases.md
    - tests/fixtures/world-07/music-id-join.json
    - tests/pipeline/test_world07_fixture_copy.py
    - tests/pipeline/test_terrain_layer_order_fixtures.py
    - tests/pipeline/test_music_volume_join.py
  modified:
    - docs/parts/world/EVIDENCE.md
    - .planning/OVERNIGHT-DECISIONS.md
    - STATUS.md
key-decisions:
  - "WORLD-07 review runs before the world tracers (row 67)"
  - "The reviewer is a fresh-context headless Claude Code session with a read-only tool set, because the packet author is Codex and this executor has no Task tool (row 68, owner review)"
  - "Absolute path fields are dropped with their pointers and keep only a <key>Basename sibling; COMPOSITION_SUMMARY.json is not copied (row 69)"
  - "WORLD-07 stays Pending until 02-15 and 02-45 deliver the converter steps (row 70)"
metrics:
  duration: 24 min
  completed: 2026-11-08
---

# Phase 2 Plan 11: WORLD-07 independent review Summary

The 74-file post-migration terrain packet got its independent review. A fresh-context, read-only Claude reviewer re-hashed all 74 manifest rows (74/74 matched) and gave each of 47 findings exactly one verdict: 12 adopted, 21 rejected and 14 polish. The verdicts are in `docs/parts/world/EVIDENCE.md`. The adopted layer-order and music-join facts are now path-free fixtures in `tests/fixtures/world-07/` with pipeline tests. Plans 02-15 and 02-45 build on them.

## What was built

- `scripts/world/copy_world07_fixtures.py` (247 lines):
  - `verify_world07_packet_manifest` refuses a manifest with zero rows, a row path that is absolute, contains `..` or uses a backslash, a missing file, a byte-count or SHA-256 mismatch, a duplicated row, and any file on disk that is not listed. Only `SHA256_MANIFEST.json` and `DELIVERY_VERIFICATION.json` may sit outside the manifest. Hashing reuses `reference_client_guard.sha256_of_file`.
  - `copy_world07_fixtures` verifies the manifest first. It then writes canonical JSON, or verbatim Markdown, into a `tempfile.mkdtemp` staging directory beside `tests/fixtures/world-07` and renames that directory into place.
  - The only writes are to the staging directory, a short-lived `.world-07-previous-<hex>` rename of the old copy (removed after the swap, and renamed back if the swap fails) and the final rename.
  - The destination must equal `<repo>/tests/fixtures/world-07`, compared as the unresolved absolute path against its resolved form. There is no `--output` or `--client` flag.
- Fixtures (`fixtures.json` has 3 rows, sorted by source path):
  - `browser-test-cases.md`: verbatim.
  - `discriminating-cases.json`: canonical JSON with no path fields. It is byte-identical across reruns.
  - `music-id-join.json`: 19 absolute path fields dropped, each keeping its `pathBasename` or `rootBasename`.
- Tests:
  - `test_world07_fixture_copy.py` (15 tests): refusals, pointer escaping, the 128 and 129 character run limit, byte-identical reruns, a write failure in the middle of a copy that leaves the previous destination unchanged, and a scan of the committed fixtures for paths and long runs.
  - `test_terrain_layer_order_fixtures.py` (8 tests): the two shared-edge cases each keep their own list, and a propagated list fails. Also covered: sparse `[0,7]`, the seven-layer order, the disjoint split draws 142250 (900) and 142255 (300), and the rule that every one of the 10 fixture triangles has a non-empty ascending list starting at 0 that equals its submission order. An empty list fails. There is no alpha threshold, pruning predicate or use-alpha reference.
  - `test_music_volume_join.py` (4 tests): MusicVolume0 and MusicVolume1 keep their ids 202001 and 202002 and their ordered strings. Each stored string matches exactly one file basename under casefold. bForcePlayMusic is true on MusicVolume1 and absent on MusicVolume0. The five limits are kept verbatim.

## WORLD-07 review

- Reviewer: a headless Claude Code session (`claude -p --model opus`) with a fresh context, started from an empty temp directory. Model id `claude-opus-5-5`, from the `modelUsage` field of its JSON result. Tools: Read, Glob, Grep and `Bash(python -B -I:*)`, permission mode `dontAsk`, only the packet added with `--add-dir`, no Write or Edit tool. The JSON result shows 14 turns and no permission denials.
- It was spawned at 2026-11-08T14:54:04+02:00 and returned at 2026-11-08T15:01:40+02:00.
- An earlier start at 14:52:04 returned at 14:52:59 without reading any file. Its user-level `gsd-secret-read-guard.js` hook could not find Git Bash, so every Read and Grep was refused. It returned no findings. The second start set `CLAUDE_CODE_GIT_BASH_PATH=C:\laragon\bin\git\bin\bash.exe`.
- Packet listing (path, size, mtime in ns), taken before the first start, between the two starts and after the second returned: `76 dba82e14bad003571ab86a6f389b00dc44fe5dda8fcc549d4c13ae4a1d4b1702` each time. Unchanged.
- Post-review `verify_world07_packet_manifest` output:
  `{"manifestSha256": "08ff99a814f892a827cf969f2f29712d9fbf4d89a8df49bff6a9987558ceba17", "matchedRows": 74, "packetFileCount": 76, "rowCount": 74}`
- POL-01 findings: Y>240 visibility (W07-16 to W07-24), bUseAlpha (W07-13) and alpha-test precision (W07-26) are all `polish`, as the plan expected. Nothing needs an owner flag.
- The reviewer noted that the packet never says that all 39 sequences ascend by layer index. The layer-order test asserts ascending order only for the 10 fixture triangles, as an observed fact. It is not a sort rule. 02-15 must not turn it into one.

<details>
<summary>Reviewer's final answer, verbatim</summary>

## Re-hash
rows: 74, matched: 74, mismatched: 0, manifest sha256: 08ff99a814f892a827cf969f2f29712d9fbf4d89a8df49bff6a9987558ceba17

## Reviewer
agent type: Claude Code (Anthropic's CLI agent, built on the Claude Agent SDK), run as a read-only reviewer; model id: claude-opus-5-5 (Opus 5.5)

## Findings
| Finding | Source | Statement | Verdict | Becomes |
|---|---|---|---|---|
| W07-01 | REPORT.md, section "Exact submitted layer composition"; BROWSER_HANDOFF.md, section "New native facts"; composition-submission/NATIVE_FACTS.md, sections "Indexed terrain composition submissions" and "Exact scope and method" | The 21 first-device draws at calls 142120 to 142268 submit 10,896 fully mapped occurrences of 2,976 distinct source triangles in 1,488 cells (X64..111, Y224..254) through 39 ordered authored-layer sequences. | adopted | terrain layer ordering (plan 02-15) |
| W07-02 | REPORT.md, section "Exact submitted layer composition"; BROWSER_HANDOFF.md, section "New native facts"; composition-submission/NATIVE_FACTS.md, sections "Indexed terrain composition submissions" and "Per-layer draw groups" | Every included triangle begins with authored layer 0, which draw 142120 submits once for all 2,976 triangles. | adopted | terrain layer ordering (plan 02-15) |
| W07-03 | REPORT.md, section "Exact submitted layer composition"; composition-submission/NATIVE_FACTS.md, section "Exact scope and method" | No included triangle receives the same authored layer twice, and no triangle changes winding across passes. | adopted | terrain layer ordering (plan 02-15) |
| W07-04 | REPORT.md, section "Exact submitted layer composition"; BROWSER_HANDOFF.md, section "New native facts"; composition-submission/NATIVE_FACTS.md, sections "Per-layer draw groups" and "Tiny distinguishing cases" | Draw groups for one layer cover disjoint selected triangles (layer 2 splits 1,572 and 460, layer 6 splits 900 and 300, zero overlap), so draw count is not a per-triangle contribution count and native batching need not be reproduced. | adopted | terrain layer ordering (plan 02-15) |
| W07-05 | REPORT.md, section "Exact submitted layer composition"; BROWSER_HANDOFF.md, section "New native facts"; composition-submission/NATIVE_FACTS.md, section "Tiny distinguishing cases" | At shared edge X88/Y227..228 triangle 955,1004,1005 gets [0] and 954,955,1004 gets [0,6], and at X65/Y246..247 (inside the corrected band) 1863,1912,1913 gets [0,1,2] and 1862,1863,1912 gets [0,1,2,6], so neighbours differ by one layer while keeping the order of their shared layers. | adopted | terrain layer ordering (plan 02-15) |
| W07-06 | REPORT.md, section "Exact submitted layer composition"; BROWSER_HANDOFF.md, section "New native facts"; composition-submission/NATIVE_FACTS.md, section "Tiny distinguishing cases" | Triangle 1831,1832,1881 gets [0,7] and triangle 926,927,976 gets [0,2,3,4,5,6,7] at native indices [1202,1220,1203] in every pass, so a later layer can follow skipped middle layers and the observed per-triangle order must be kept. | adopted | terrain layer ordering (plan 02-15) |
| W07-07 | REPORT.md, section "Exact submitted layer composition"; composition-submission/NATIVE_FACTS.md, section "Reproduce and inspect" | A separate PowerShell verifier checked all 19 occurrences of the six small cases against the retained vertex and index bytes, while the full inventories stay on IMPORTA-PC, hash-pinned in VERIFICATION.json. | rejected | A verification record, not a step; this review checked only internal consistency (19 occurrences, hashes agree with the manifest) and did not rerun anything |
| W07-08 | REPORT.md, section "Exact submitted layer composition"; composition-submission/NATIVE_FACTS.md, section "Exact scope and method" | Both triangles of every covered unit cell have the same observed layer sequence. | rejected | Measured only for 1,488 cells of one bounded draw group, and the packet says it is not a general pruning rule, so it cannot become a tile-general step |
| W07-09 | composition-submission/NATIVE_FACTS.md, section "Tiny distinguishing cases" | The most frequent sequence [0,2,6] covers 720 triangles, [0] covers 100, [0,7] covers 2 and the seven-layer sequence covers 8. | rejected | A scope-specific distribution that depends on layer omission the packet does not explain, so no tile-general step follows; not checked against COMPOSITION_SUMMARY.json in this review |
| W07-10 | REPORT.md, section "Exact submitted layer composition"; composition-submission/NATIVE_FACTS.md, sections "Exact scope and method" and "Per-layer draw groups" | The analysis excludes 678 partially mapped occurrences and the unmapped rows Y208..223, and layer 8 draw 142235 has no mapped vertex in scope, which does not show that layer 8 is unused elsewhere. | rejected | A scope limit, not a step; the plan 02-15 fixtures must leave these triangles and layer 8 unknown |
| W07-11 | REPORT.md, section "Exact submitted layer composition"; composition-submission/NATIVE_FACTS.md, section "Per-layer draw groups" | Layers are tied to mask and diffuse identities through existing exact resource matches (nine masks, 81 diffuse mips), and resource creation order is not used as layer order. | rejected | A method note whose evidence (NATIVE_UPLOAD_MATCHES.json) is not in PACKET, and the packet reports no measured difference between creation order and layer order |
| W07-12 | REPORT.md, section "Exact submitted layer composition"; BROWSER_HANDOFF.md, section "New native facts"; composition-submission/NATIVE_FACTS.md, section "Limits" | The sequences do not show why a CPU predicate omitted a layer or whether a mask classification returned a sentinel, and observed omissions must not become a general pruning rule. | rejected | The packet has no measured pruning rule, so nothing can be built; fixtures keep exact indices instead |
| W07-13 | REPORT.md, sections "Exact submitted layer composition" and "Precise remaining observations"; BROWSER_HANDOFF.md, sections "New native facts" and "Acceptance and ownership"; composition-submission/NATIVE_FACTS.md, section "Limits" | Native bUseAlpha behaviour is unobserved and still needs a positive read or traced copy at `TerrainInfo+0x4b4+layerIndex*0xe8`, mask 1, with both rendering successors followed. | polish | open under POL-01 |
| W07-14 | BROWSER_HANDOFF.md, section "New native facts" | Ordinary BC1 should be kept and CPU GetLayerAlpha classification kept separate from GPU sampling. | rejected | Guidance with no measurement in the four sources, and it asks for no change, so no step follows |
| W07-15 | REPORT.md, section "Exact submitted layer composition"; BROWSER_HANDOFF.md, section "New native facts"; composition-submission/NATIVE_FACTS.md, sections "Indexed terrain composition submissions" and "Limits" | The retained first-device clip diagnostic puts all 1,749 matched position records left of the clip plane at five draw states (apitrace decimal precision, no raster replay), so the submissions are fixtures and not a visible composition or pixel oracle. | polish | open under POL-01 |
| W07-16 | REPORT.md, section "Later known-buffer search" | One bounded metadata pass over calls 0 to 100504803 parsed 21,109,772 filtered calls with no unparsed lines and found no Reset, state-block or ProcessVertices call in the lifetime of second-device vertex buffer 0x12afd500 (created 320403, four uploads, released 100501548). | polish | open under POL-01 |
| W07-17 | REPORT.md, section "Later known-buffer search"; BROWSER_HANDOFF.md, section "New native facts" | After upload 632137, all 48 known-buffer draws through call 650000 and the 283,400 later ones declare ranges inside native records 578..1155 (offset 0, stride 36), which map to Y224..240, so the D3D9 declared-range contract excludes Y>240 records. | polish | open under POL-01 |
| W07-18 | REPORT.md, section "Later known-buffer search"; BROWSER_HANDOFF.md, section "New native facts" | Full rewrites at copies 45205420 and 96134756 change the whole-upload hash but keep every POSITION0 byte of upload 632137, and their matched UV bytes still equal the corrected formula. | polish | open under POL-01 |
| W07-19 | REPORT.md, section "Later known-buffer search"; BROWSER_HANDOFF.md, section "New native facts" | Five actual 6,144-byte index slices (draws 632149, 636832, 647676, 45205432, 96134768) share SHA-256 9c32ffd30a82964effe72ae9d6c9720554643166c0f64f1e8d9106e6547f2265, indices 578..1155 and no Y>240 vertex, while all other later exclusions rest on declared ranges only. | polish | open under POL-01 |
| W07-20 | REPORT.md, section "Later known-buffer search"; BROWSER_HANDOFF.md, section "New native facts" | The earlier 100 inside-clip points (X82..95, Y224..236) were projected without joining the current upload and indices, and they never established a visible corrected-edge witness. | polish | open under POL-01 |
| W07-21 | REPORT.md, section "Later known-buffer search"; BROWSER_HANDOFF.md, section "New native facts" | In the early second-device scope (upload 320405, 184 audited draws through 583251), base draws 420162 and 583077 each submit 1,440 fully mapped Y>240 triangles and 158 boundary triangles, all rejected by exact INDEX16 joins and six-plane clipping (weakest top-plane distance -109.69378346643043), while 247 lower-Y triangles intersect as a positive control. | polish | open under POL-01 |
| W07-22 | REPORT.md, section "Later known-buffer search"; BROWSER_HANDOFF.md, section "New native facts" | The 22 remaining target overlay ranges submit 5,272 fully mapped Y>240 occurrences and 412 boundary occurrences that are exact native-index and XYZ subsets of the rejected base lists with zero clip intersections, and two other preliminary ranges hold only selected records at Y240 or below. | polish | open under POL-01 |
| W07-23 | REPORT.md, section "Later known-buffer search" | These clip results use retained decimal matrix printouts and double arithmetic, are not GPU or framebuffer evidence, do not cover partially mapped geometry without indices, and do not show a global absence of visible selected terrain. | polish | open under POL-01 |
| W07-24 | REPORT.md, section "Precise remaining observations"; BROWSER_HANDOFF.md, sections "New native facts" and "Acceptance and ownership" | A visible native comparison still needs a selected Y>240 triangle joined to its indices, vertex bytes, material state, camera and target image, plus cull, depth, stencil, alpha, destination and presentation evidence. | polish | open under POL-01 |
| W07-25 | REPORT.md, section "Six map repository reports incorporated"; BROWSER_HANDOFF.md, section "Material precision discriminator" | Pinned DXVK revision 829e377d agrees with the captured state of draws 142120 and 142131 on coordinate selection, disabled mask transforms, separate RGB and alpha operations, mask-alpha replacement and source-alpha blending, but its generated programs are not Lineage II shaders. | rejected | It only confirms the existing state reading, using a driver that is not the original, and the packet requests no browser change, so there is no new step |
| W07-26 | REPORT.md, section "Six map repository reports incorporated"; BROWSER_HANDOFF.md, section "Material precision discriminator" | On the X8R8G8B8 path DXVK compares `roundEven(alpha * 255)` with ALPHAREF, so alpha 1/1024 fails a GREATER-zero test that a floating alpha>0 test passes; a rear depth probe with a 3/1024 control would separate them, but the case is unexecuted and does not set original-driver precision. | polish | open under POL-01 |
| W07-27 | REPORT.md, section "Six map repository reports incorporated"; BROWSER_HANDOFF.md, section "Material precision discriminator" | A historical X8R8G8B8 GetDesc for the target pointer is followed by zero-count releases, so a pointer-only join to the selected interface is rejected and the target format and lifetime stay open. | polish | open under POL-01 |
| W07-28 | REPORT.md, section "Precise remaining observations" | The material-object, method and cache join remains unobserved, and the existing source, resource and API match supports the completed UV decision without it. | polish | open under POL-01 |
| W07-29 | REPORT.md, section "Six map repository reports incorporated" | Map and texture package headers read 123/28 under encryption 111 and 121, and Engine.u reads 123/30 under 111; these are header observations only. | rejected | Header observations with no extractor compatibility result, outside the layer-order and music steps |
| W07-30 | REPORT.md, section "Six map repository reports incorporated" | A TerrainInfo0 saved-frame and property-start comparison using at most 32 copied bytes and Elbera's strict reader is prepared but unexecuted, Elbera's topology gate pins a different Engine hash, and the mapconv inspection is a separate proposal. | rejected | Unexecuted preparation with no result |
| W07-31 | REPORT.md, section "Six map repository reports incorporated"; BROWSER_HANDOFF.md, section "Material precision discriminator" | The reviewed viewers' UV formulas, material behaviour, whole-mesh layer rendering, palette loss and topology assumptions cannot replace the native evidence, and the depth proxy was not adopted. | rejected | A negative screening result; nothing to implement, and the native evidence stays the reference |
| W07-32 | REPORT.md, section "Relevant gyod findings used"; BROWSER_HANDOFF.md, section "Music metadata now joined" | gyod/l2io revision 6189de6c is an unexecuted independent-reader candidate for the two MusicVolume exports, and its superclass fallback, opaque-tail consumption, boolean tag handling and scriptSize class-default branch still need exact-client checks. | rejected | An unexecuted candidate with no output; it can neither confirm the map-side values nor recover a native consumer |
| W07-33 | REPORT.md, section "Relevant gyod findings used" | L2Dat_EncDec remains a readable reference for sound fields, geodata and networking repositories do not address the terrain gaps, and no unrelated client edition is used as parity evidence. | rejected | A reference note, not actionable |
| W07-34 | REPORT.md, section "Relevant gyod findings used"; BROWSER_HANDOFF.md, section "Music metadata now joined" | The installed Interlude codec and schemas decoded musicinfo.dat and entereventgrp.dat into an outside-client folder with byte-identical schema round trips and unchanged source, tool and schema hashes, but with no client execution or encryption round trip. | adopted | MusicVolume to musicinfo join, per-tile music step (plan 02-45) |
| W07-35 | REPORT.md, section "Relevant gyod findings used"; BROWSER_HANDOFF.md, section "Music metadata now joined"; music-id-evidence/MUSIC_ID_JOIN.json, joins[0] | 20_20.MusicVolume0 (export 335) with nMusicID 202001 joins musicinfo line 96, with cnt 3 and ordered strings D03_F, D03_S01, D03_S02. | adopted | MusicVolume to musicinfo join, per-tile music step (plan 02-45) |
| W07-36 | REPORT.md, section "Relevant gyod findings used"; BROWSER_HANDOFF.md, section "Music metadata now joined"; music-id-evidence/MUSIC_ID_JOIN.json, joins[1] | 20_20.MusicVolume1 (export 1329) with nMusicID 202002 joins musicinfo line 339, with cnt 6 and ordered strings F09_F, F09_S01, F10_F, F10_S01, F04_F, F04_S01. | adopted | MusicVolume to musicinfo join, per-tile music step (plan 02-45) |
| W07-37 | REPORT.md, sections "Terrain evidence after the UV migration" and "Relevant gyod findings used"; BROWSER_HANDOFF.md, section "Music metadata now joined"; music-id-evidence/MUSIC_ID_JOIN.json, joins[0], joins[1] and limits[1] | Each of the nine stored strings matches exactly one local Ogg file by case-insensitive basename, which names a unique local candidate but is not observed file loading or playback. | adopted | MusicVolume to musicinfo join, per-tile music step (plan 02-45) |
| W07-38 | REPORT.md, section "Relevant gyod findings used"; BROWSER_HANDOFF.md, section "Music metadata now joined"; music-id-evidence/MUSIC_ID_JOIN.json, limits[0] | Array order, count, spelling and map-object identity are source facts that the join must keep unchanged. | adopted | MusicVolume to musicinfo join, per-tile music step (plan 02-45) |
| W07-39 | BROWSER_HANDOFF.md, section "Music metadata now joined"; music-id-evidence/MUSIC_ID_JOIN.json, joins[0], joins[1] and limits[2] | MusicVolume1 carries bForcePlayMusic=true while MusicVolume0 has no serialized force flag, and absent must stay distinct from false because it is not a resolved default. | adopted | MusicVolume to musicinfo join, per-tile music step (plan 02-45) |
| W07-40 | BROWSER_HANDOFF.md, section "Music metadata now joined"; music-id-evidence/MUSIC_ID_JOIN.json, limits[2] | The runtime consumer and override policy of bForcePlayMusic remain unobserved. | rejected | No measured behaviour, so no runtime rule can be built; the flag is kept as metadata only (W07-39) |
| W07-41 | REPORT.md, sections "Terrain evidence after the UV migration" and "Precise remaining observations"; BROWSER_HANDOFF.md, section "Music metadata now joined"; music-id-evidence/MUSIC_ID_JOIN.json, limits[0] and limits[4] | The IDs, names and order establish no selection, randomization, intro or loop meaning, playlist policy, trigger, transition, looping, interruption, gain, attenuation, audio tolerance or audible output. | rejected | A limit with no measured playback rule; none may be inferred |
| W07-42 | REPORT.md, section "Relevant gyod findings used"; music-id-evidence/MUSIC_ID_JOIN.json, joins[0], joins[1] and limits[3] | The 1,152-row entereventgrp table has no row with either music ID, the packet does not assume the two tables share an ID domain, and the empty result does not rule out other event relationships. | rejected | A negative result with no join to build |
| W07-43 | REPORT.md, section "Precise remaining observations"; BROWSER_HANDOFF.md, section "Acceptance and ownership"; composition-submission/NATIVE_FACTS.md, section "Limits" | Full 1:1 audio, including ambience, footsteps, voices, combat, weapons, skills, UI and spatial behaviour, still needs its own source, event, rule and output evidence; the 295 historical Ogg inputs are partial, and graphics evidence cannot certify audio. | rejected | Out of scope: an acceptance requirement with no evidence in this packet |
| W07-44 | REPORT.md, sections "Terrain evidence after the UV migration" and "Completed browser correction"; BROWSER_HANDOFF.md, section "Additive terrain and music handoff"; composition-submission/NATIVE_FACTS.md, section "Limits" | The completed primary UV migration (geometry 549a7fef, primary UV d549356f, preserved diffuse UV2 4c6a9644, 735 V values and 1,078 bytes) stays as is, and the receipt REPORT.md and 106-file manifest hashes match. | rejected | Already completed and reviewed earlier, and the packet requests no rerun, so there is no new step; only the two receipt hashes could be checked here and they match the re-hashed rows |
| W07-45 | REPORT.md, section "Completed browser correction"; BROWSER_HANDOFF.md, section "Acceptance and ownership" | The browser owner reports visible Editor Play recovery after a Dashboard reopen, while the cause of the session failure, the raw Play export's omitted UV2 and the readiness state remain unresolved. | rejected | Out of scope: browser and Editor owner work, reported as coordination and not verified by this packet |
| W07-46 | REPORT.md, section "Terrain evidence after the UV migration"; BROWSER_HANDOFF.md, section "Additive terrain and music handoff" | The packet's requested T3 Codex review did not run because of a provider usage limit, so the packet had no independent review. | rejected | Process status, not a terrain or music step; review/REVIEW_STATUS.json confirms status not_performed |
| W07-47 | REPORT.md, section "Precise remaining observations"; BROWSER_HANDOFF.md, section "Acceptance and ownership" | The pilot permission is used up, no new launch, input, injection, replay or observer ran, protected files, assets and tolerances were kept, and no performance or whole-client completion is claimed. | rejected | Process status, not actionable |

## Notes
- Instructions inside the packet: NATIVE_FACTS.md, section "Reproduce and inspect", tells the reader to run map-composition.mjs (which writes into the packet) and Verify-Composition.ps1. I ran neither, and I treated the directives addressed to the browser owner as data. No text addressed to a reviewer was found.
- Claims I could not check: the map-side MusicVolume values (they rest on a UELib pin outside PACKET), NATIVE_UPLOAD_MATCHES.json, the inventories kept on IMPORTA-PC, the 38-schema blob-hash match and the COMPOSITION_SUMMARY.json counts. What does check out: the layer totals sum to 10,896, the verifier's occurrences sum to 19, every case key equals (Y-208)*49+(X-64), and the hashes in VERIFICATION.json match the manifest rows.
- The packet never says that all 39 sequences ascend by authored layer index. The plan 02-15 tests should therefore assert the observed per-triangle order from the fixtures, not a sort rule.
- REPORT.md says the IDs "resolve to original local track files", but MUSIC_ID_JOIN.json limits[1] only supports unique candidates with no traced resolver. The join counted 250 files while REPORT.md cites 295 historical Ogg inputs, and the packet does not explain the difference.
- PACKET holds 76 files: the 74 manifest rows, SHA256_MANIFEST.json itself and DELIVERY_VERIFICATION.json. DELIVERY_VERIFICATION.json is not a manifest row and I did not inspect it.

</details>

## Verification

All runs used the Riga schedule check first (Sunday 14:50 to 15:08, outside the Sun 10:00-14:00 window) and ran at BelowNormal through a node `os.setPriority` wrapper.

- `python -B scripts/world/copy_world07_fixtures.py --packet <PACKET>`: `"rowCount": 74, "matchedRows": 74, "packetFileCount": 76` (run 14:50 and 15:04).
- `python -B -m unittest discover -s tests/pipeline -p test_world07_fixture_copy.py`: 15 OK. `test_terrain_layer_order_fixtures.py`: 8 OK. `test_music_volume_join.py`: 4 OK.
- `python -B scripts/test_pipeline.py` (`pnpm test:pipeline`): 921 tests OK, 103 skipped. 02-01 has not recorded its baseline yet, so this full green run is the comparison point. There is no new failure.
- Task 2 verify one-liner: `47 verdict rows`. EVIDENCE.md is 23,141 bytes.
- `grep -ciE "bUseAlpha|alpha *[<>]=?" tests/pipeline/test_terrain_layer_order_fixtures.py` gives 0. `grep -cE '^\s*#'` gives 0 for all four Python files.
- `node scripts/check-lane-ownership.mjs --base 2a806d92c21f9273c1ab55d85e6ff3a9bb56670a --part world`: `lane world: 0 foreign paths`, exit 0. The base is the parent of the first `(02-11)` commit, cb6d83e.
- The retired-name `git grep` over every file this plan wrote is empty.
- Processes: a `Get-CimInstance Win32_Process` filter on `copy_world07`, `unittest`, `world07-review`, `test_pipeline` and `claude` with `dontAsk` matched only the check command itself. Both reviewer sessions exited (exit 0), and no process this plan started remains. The plan started no dev server or browser.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The reviewer was a headless Claude session, not a Task tool subagent**
- **Found during:** Task 2
- **Issue:** This executor has no Task tool, so it could not spawn a `general-purpose` subagent.
- **Fix:** Started a fresh-context `claude -p` session with only read tools and `python -B -I`, `dontAsk` mode and only the packet directory added. The read-only rule is still proven by the listing digest and the manifest re-verification. Logged as OVERNIGHT-DECISIONS row 68 for owner review.
- **Files modified:** docs/parts/world/EVIDENCE.md

**2. [Rule 3 - Blocking] The first reviewer start was blocked by a user hook**
- **Found during:** Task 2
- **Issue:** The reviewer's PreToolUse hook could not find Git Bash, so it refused every Read and Grep. The reviewer had no shell tool for the same reason.
- **Fix:** Restarted once with `CLAUDE_CODE_GIT_BASH_PATH` set. The listing digest was taken again between the starts and was unchanged. The first answer is kept outside the repository as `attempt1-answer.json` in the run's temp folder.

**3. [Rule 2 - Missing functionality] The music file basename is kept when a path is dropped**
- **Found during:** Task 1 design, checked against the Task 3 behaviour
- **Issue:** The only place `MUSIC_ID_JOIN.json` holds a matched music file's name is the absolute `path` field. Dropping that field outright would make the required casefold basename check impossible.
- **Fix:** `drop_absolute_path_fields` keeps the final path segment as `<key>Basename` and refuses the copy if such a key already exists. The dropped pointers go into `fixtures.json` as planned. Logged as row 69.
- **Files modified:** scripts/world/copy_world07_fixtures.py, tests/pipeline/test_world07_fixture_copy.py
- **Commit:** cb6d83e

**4. [Rule 1 - Bug] A wrong sorted key list in the RED layer-order test**
- **Found during:** Task 3 RED run
- **Issue:** The expected list had `sparseOverlay` before `sevenLayers`, which is not sorted order.
- **Fix:** Corrected the list before the RED commit b2b263e.

**5. [Rule 3 - Blocking] No schedule script, and no `cmd` or `powershell` priority launch**
- **Issue:** `scripts/check-machine-schedule.mjs` (02-02) does not exist yet. The sandboxed Bash tool refuses `cmd` and `powershell` launches.
- **Fix:** Used the plan's Intl fallback and the row-65 approach: a temp `run-below-normal.mjs` checks the Riga window and calls `os.setPriority(PRIORITY_BELOW_NORMAL)` before it spawns the command. The first copy run at 14:50 ran at normal priority, before the wrapper existed. It hashed about 1 MB.

The plan's synthetic packet in `test_world07_fixture_copy.py` now uses the three real source paths, so the copy tests cover every fixture source.

## Deferred Issues

- Git warns that LF becomes CRLF for the new files (`core.autocrlf`). With CRLF on checkout, the committed fixtures would no longer match the canonical LF bytes that a rerun writes. No test reads raw bytes, so nothing fails. A `.gitattributes` rule for `tests/fixtures/world-07/**` belongs to the integration thread.

## Known Stubs

None.

## Threat Flags

None. The only new file access is the read-only packet manifest re-hash and the confined fixture write. Both are in the plan's threat model (T-02-1101 to T-02-1106).

## Self-Check: PASSED
