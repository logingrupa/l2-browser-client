# Requirements

Sources: PRD documents PRODUCT.md (precedence 0), docs/PORT_SCOPE.md (1), .planning/goal.md (2). None of the three has user stories or formal acceptance-criteria sections; where the source states no acceptance test, the entry says "absent in source". The depth-first work-order variant (REQ-work-order-v2) is drawn from docs/ROADMAP.md (DOC, precedence 8) and corroborating SPEC text, because that is where the depth-first order is actually written; .planning/goal.md only contributes the scope boundary (see its entry).

Current state: the owner answered every WARNING at the conflict gate (DEC-OWN-1..8, 2026-11-08); the active requirement IDs are in .planning/REQUIREMENTS.md. Source citations quote the docs as of the ingest: docs/ROADMAP.md content is in .planning/ROADMAP.md and .planning/STATE.md, docs/ASSET_BATCHING.md is in docs/ASSET_PIPELINE.md, and Editor docs are in docs/EDITOR_VIEWER.md.

## REQ-work-order-v1-breadth-first
- source: docs/PORT_SCOPE.md, section 6 "Order of work" (PRD, precedence 1)
- description: "This follows the owner decision above: the full converted client first, the server adapter after." Stage A "converts the whole client and proves it in the offline sandbox": (1) decode all 40 `.dat` tables to JSON and fix the sysstring/systemmsg count; (2) batch-convert all 153 tiles with the pipeline that already converts 20_20; (3) all player characters, every race, gender and class; (4) NPCs and monsters from npcgrp, item and armor meshes; (5) skill visuals and sounds bound through skillgrp, skillsoundgrp and npcgrp; (6) UI windows read from the decoded interface layout, filled with sandbox data. Stage B "plugs in a server through `GameWorldAdapter`": (1) Mobius adapter (login, character select, world entry, then event dispatch one packet type at a time); (2) combat, dialogs, shops, social and quest windows, which mostly display server data; (3) if Mobius does not fit, a SpacetimeDB adapter emitting the same adapter events.
- acceptance: "The sandbox is the acceptance tool for stage A. It can walk any tile, spawn any NPC by ID, equip any item, play any skill's visual and sound and open any window. Each part is checked there against the real L2.exe."
- scope: whole project sequencing. VARIANT v1 of 2. This is the work order (DEC-OWN-1); REQ-work-order-v2-depth-first is rejected.

## REQ-work-order-v2-depth-first
- source: docs/ROADMAP.md, "Current direction and next work - 2026-11-07" (DOC, precedence 8); corroborated by docs/ASSET_PIPELINE.md (SPEC, 5), docs/NATIVE_AUDIO.md "Current sequencing and system bundles - 2026-11-07" (SPEC, 7), docs/ASSET_BATCHING.md "Next work, in the user's order" (DOC, unnumbered). .planning/goal.md (PRD, 2) is the pointer the owner cited; its text is the Phase 1 foundation brief and does not itself state this order (see REQ-phase1-foundation).
- description: ROADMAP.md: "The user's latest sequencing is explicit: **finish human male/female, their class skills and usable 20_20 traversal before expanding to other races or map tiles**." ASSET_BATCHING.md next work: (1) preserve scoped male/female world profiles, complete remaining human bases, appearance and equipment, footsteps, interactive Editor save proof; (2) establish the human class and skill inventory and complete their character/animation/effect/audio bundles; (3) preserve the indoor-stair repair, with automatic routing around turns, indoor camera obstruction and complete 20_20 traversal open; (4) "Only after this human/class-skill/20_20 milestone, extend other races/sexes and map tiles through independently runnable system scripts"; (5) one persistent runtime Scene with bounded cells, residency/LOD/instancing as measured.
- acceptance: absent as a single criterion. ROADMAP.md states "No complete 20_20 or all-human acceptance is claimed" and lists open items: automatic routing around turns, upper-landing camera roof occlusion, other human bases/classes, skills, automatic surface footsteps, a new interactive Editor save. docs/NATIVE_PARITY.md (SPEC, 4) adds "Batch only supported asset routes after the slice works; publish coverage and explicit gaps, not a complete-client claim."
- scope: whole project sequencing. VARIANT v2 of 2. Rejected by DEC-OWN-1 (breadth-first). Its open items are POL-02, POL-03 and ACT-01 in .planning/REQUIREMENTS.md.

## REQ-full-converted-client
- source: docs/PORT_SCOPE.md, "Owner decisions" item 1 and section 2 (precedence 1)
- description: Every client asset converted to something the browser loads: 40 `.dat` tables (1.7 MB) decoded once per client build to JSON; `interface.xdat` (248 top-level records, 2,638 controls, about 140 real windows); 153 world tiles (`XX_YY` grid, X 15 to 26, Y 10 to 26); textures (387 + 70 systextures files, 33,410 textures in 433 `.utx` packages when exported with UE Viewer), staticmeshes (212), animations (20), sounds (26), music (250), voice (46).
- acceptance: see REQ-offline-sandbox. Coverage is expressed as counts in docs/PORT_SCOPE.md section 5 parts table; no pass/fail percentage is defined.
- scope: stage A conversion.

## REQ-dat-tables-decoded
- source: docs/PORT_SCOPE.md, sections 2, 3, 5 part 1, 6 stage A item 1 (precedence 1)
- description: Decode all 40 `.dat` tables to JSON. "The other 29 tables have not been decoded to JSON yet" (11 done via Elbera's `tools/dat/extract_gamedata.py`: npcgrp, npcname-e, itemname-e, etcitemgrp, weapongrp, armorgrp, skillgrp, skillname-e, sysstring-e, systemmsg-e, actionname-e). "sysstring-e and systemmsg-e report the same count [2,083]. That looks like a parser quirk and needs a check before anything depends on it."
- acceptance: absent in source other than "fix the sysstring/systemmsg count".
- scope: part 1 (Cv), layer 0. Decoder route set by DEC-OWN-4: local hash-pinned descriptor first, Elbera fills gaps behind an adapter.

## REQ-world-tiles-batch
- source: docs/PORT_SCOPE.md, sections 2 and 6 stage A item 2 (precedence 1)
- description: "All 153 tiles share one file format. Converting the world is one pipeline run over every tile, not a job per area." Batch-convert all 153 tiles with the pipeline that already converts 20_20. The 10 non-tile maps (`Lobby`, `entry`, `skylevel`, `ship_position`, `Auto0` to `Auto5`) are noted; "Nobody has checked yet what the Auto maps are."
- acceptance: sandbox can walk any tile; checked against L2.exe.
- scope: part 3 (Cv+Cl), layer 1. DEC-OWN-7 narrows "one pipeline run" to tile-general converter steps, with failing tiles listed as gaps (WORLD-01). Depends on streaming/LOD (docs/ARCHITECTURE.md: "Neither route currently implements a bounded world-streaming cache or terrain/mesh LOD").

## REQ-player-characters
- source: docs/PORT_SCOPE.md, section 5 part 4 and section 6 stage A item 3 (precedence 1)
- description: All player characters, every race, gender and class (5 races, 2 genders, fighter and mystic). State on 2026-11-07: "Human fighters native. Human mystic export in progress."
- acceptance: sandbox check against L2.exe (see REQ-offline-sandbox).
- scope: part 4, layer 1.

## REQ-npcs-items-skills-audio
- source: docs/PORT_SCOPE.md, section 5 parts 6 to 9 and section 6 stage A items 4 and 5 (precedence 1)
- description: NPCs and monsters from npcgrp (6,519 rows, about 554 meshes); items and equipment on the body (9,238 items, about 390 weapon and 1,355 armor meshes); skill visuals and effects (about 2,700 skills, 864 effect classes, 3,709 emitters) bound through skillgrp, skillsoundgrp and npcgrp; audio (5,269 sounds, 250 music files, 45 voice files).
- acceptance: absent in source other than the sandbox check.
- scope: parts 6 to 9, layer 2. Current state: 1 NPC (Greater Musveren); items "Not seen in the code"; Power Strike in progress; 20_20 footsteps, ambience and music in progress.

## REQ-ui-windows-from-decoded-layout
- source: docs/PORT_SCOPE.md, sections 2 "UI", 5 part 5 and 6 stage A item 6 (precedence 1)
- description: UI windows read from the decoded `interface.xdat` layout and filled with sandbox data. "Code that hardcodes control names breaks on this client. Read layouts from the decoded tree instead." This client's status window uses `StatusLeftTex`, `CPBarTex`, `HPBarTex`, `MPBarTex`, not Elbera's `StatusWndLeftTex` / `CPBar`.
- acceptance: absent in source.
- scope: part 5, layer 1 in the parts table but step 6 (last) of stage A. State: "Development sheet only".

## REQ-offline-sandbox
- source: docs/PORT_SCOPE.md, section 5 part 2 and section 6 (precedence 1)
- description: "Offline sandbox: spawn, equip, cast, open any window without a server." Must "walk any tile, spawn any NPC by ID, equip any item, play any skill's visual and sound and open any window."
- acceptance: "Each part is checked there against the real L2.exe." L2.exe on IMPORTA-PC is the reference (DEC-OWN-2); stage A uses the per-part screenshot / listen check and fixed thresholds apply to Phases 5-6 (DEC-OWN-3).
- scope: part 2 (Cl), layer 0. State: `MockWorldAdapter` and `NativeSliceAdapter` exist; "no by-ID spawning yet".

## REQ-client-displays-server-outcomes
- source: docs/PORT_SCOPE.md, "Owner decisions" item 3 and section 1 (precedence 1)
- description: The client never computes gameplay outcomes. Server messages are already resolved: `Attack` carries target, damage, a flags byte (critical, miss, shield, soulshot) and positions; `UserInfo` carries stats, HP/MP, level, exp, sp, load and paperdoll item IDs; `StatusUpdate` carries object ID plus attribute/value pairs; `MagicSkillUse` carries caster, target, skill ID and level, cast time and reuse. Tooltips read stats from the server side, not `.dat` display copies.
- acceptance: absent in source.
- scope: parts 14 to 19, layers 3 to 4.

## REQ-gameworldadapter-sole-entry
- source: docs/PORT_SCOPE.md, sections 1 and 7 (precedence 1); docs/ARCHITECTURE.md "Adapter event flow" (SPEC, 3)
- description: "`GameWorldAdapter` is the only way gameplay state enters the client." "The five methods of `GameWorldAdapter` stay frozen. Below it, each adapter turns its server's messages into typed records with no Babylon types."
- acceptance: absent in source. Golden fixtures (captured Mobius packets in stage B) are the stated test mechanism.
- scope: adapter boundary for Mobius and SpacetimeDB adapters.

## REQ-stage-b-mobius-adapter
- source: docs/PORT_SCOPE.md, sections 4, 5 parts 12 to 13 and 6 stage B (precedence 1); PRODUCT.md "Phase 2" (precedence 0)
- description: PORT_SCOPE: Mobius adapter for login, character select, world entry, then event dispatch one packet type at a time (215 client-to-server and 279 server-to-client packet classes on Mobius; 32 request systems tabulated in section 4). PRODUCT.md: "**Real M0 networking**, still planned: establish Interlude authentication, character selection and world entry against stock Mobius. Preserve `GameWorldAdapter` as the future integration boundary."
- acceptance: docs/ROADMAP.md: "Phase 2 evidence must demonstrate actual authentication, character selection, and entry into a stock server's world. The synthetic demo, asset imports, and placeholder login screens do not establish those results."
- scope: stage B, layer 3.

## REQ-spacetimedb-fallback-adapter
- source: docs/PORT_SCOPE.md, "Owner decisions" item 2, section 1 and section 6 stage B item 3 (precedence 1)
- description: If Mobius does not fit the gameplay loop, a SpacetimeDB adapter emits the same adapter events from its tables. A SpacetimeDB server needs its own data: the Mobius datapack (plain XML) can be exported once into its tables as starting values (NPC templates, skills, items, spawns, XP table). `Formulas.java` (2,028 lines) "only needs porting if the L2 combat math stays."
- acceptance: absent in source.
- scope: stage B fallback.

## REQ-relay-limits
- source: docs/PORT_SCOPE.md, section 6 "Transport for a Mobius adapter" (precedence 1)
- description: A browser cannot open raw TCP to 2106 and 7777, so a WebSocket hop is needed. Mobius sees only the relay's IP; no PROXY protocol support. Per-IP settings: login `Server.ini` LoginTryBeforeBan 5 / LoginBlockAfterBan 900 s; flood protection True, FastConnectionLimit 15, FastConnectionTime 350, NormalConnectionTime 700, MaxConnectionPerIP 50; `DualboxCheckMaxPlayersPerIP` 0 (off). The relay must keep its own per-player limits and login-failure bans, log which account came from which address, and only connect to the configured Mobius ports.
- acceptance: absent in source.
- scope: stage B transport.

## REQ-multi-agent-workflow
- source: docs/PORT_SCOPE.md, sections 7 and 8 (precedence 1)
- description: Commit first; one part per thread per branch named `<part>/<slug>`; lanes via `lane.ps1` or plain `git worktree`, at most 3 lanes, no `lane new`/`lane rm` on Thu 19:00-21:30 and Sun 10:00-14:00; scripts writing the native store run only in the main checkout; `STATUS.md` one line per part, `DECISIONS.md` append-only; merge one branch at a time; contract changes merge first. Contracts the integration lane owns: output contract (`.l2asset` packages plus runtime catalog; `recipes/native-inputs.lock.json` stays input-only, DEC-OWN-5), frozen adapter boundary, golden fixtures, one evidence doc per part `docs/parts/<part>/EVIDENCE.md` under about 30 KB, folder ownership in `.planning/lanes.json`. Lane count: three lanes plus integration (DEC-OWN-6).
- acceptance: absent in source.
- scope: process. Lane cap versus per-area lanes is set by DEC-OWN-6 (L1 world, L2 actors, L3 data + UI, plus integration).

## REQ-client-side-behaviors
- source: docs/PORT_SCOPE.md, section 1 (precedence 1)
- description: "Some behavior stays in the client whatever the server: animation, camera, UI, choosing which footstep or hit sound plays, effect timing, and smoothing movement between server updates."
- acceptance: absent in source.
- scope: presentation layer.

## REQ-modern-webgpu-rendering
- source: PRODUCT.md "Rendering direction - 2026-11-07" (precedence 0)
- description: Babylon.js WebGPU preserving visual identity, source asset relationships and gameplay behavior. World chunking/streaming, terrain and mesh LOD, compatible static instancing, GPU texture compression and visibility culling "as measured engineering work". "Begin a representative baseline now; overall native parity is not a prerequisite for bounded rendering improvements."
- acceptance: "Existing fidelity and hardware acceptance thresholds remain unchanged." The thresholds themselves live in docs/NATIVE_PARITY.md and recipes/native-parity.acceptance.json ; they are extracted in constraints.md under "Native parity fixed acceptance contract", "Native parity visual evidence" and "Performance protocol and target".
- scope: rendering.

## REQ-original-audio-1to1
- source: PRODUCT.md "Capabilities and constraints" (precedence 0); docs/NATIVE_AUDIO.md (SPEC, 7)
- description: PRODUCT.md: "The user's 2026-11-06 1:1 requirement includes original Interlude audio, with native timing, selection, looping, volume and spatial/listener behavior." "Decoding or asset-inspector playback does not satisfy them." NATIVE_AUDIO.md categories: background and region music; environmental ambience and positioned or looping emitters; footsteps with correct surface and character/equipment selection; character, NPC and monster voices/actions incl. death; combat, weapon, skill cast/impact and effect sounds; UI sounds and their interaction triggers.
- acceptance: docs/NATIVE_AUDIO.md "Evidence required to pass": real world gestures/actions; exact source/event identity, actor clock, scheduled and observed onset, duration, output measurements, errors, cleanup; mute/volume, browser unlock, repeats, interruption, surface/region changes, positional behavior; matched native/browser recordings. "Numerical audio tolerances are currently **unestablished**, so native audio parity cannot pass."
- scope: audio, all systems.

## REQ-asset-structure-preserved
- source: PRODUCT.md "Capabilities and constraints" (precedence 0)
- description: "Preserve the original character-part, equipment, skeleton, attachment, material and animation relationships represented by the supplied files and manifests. ... valid content must not be renamed, flattened, rebaked or uniformly resized to satisfy prototype assumptions. Conversion changes require a demonstrated defect or loss of required source structure."
- acceptance: absent in source.
- scope: asset conversion and loaders.

## REQ-native-route-no-stand-ins
- source: PRODUCT.md "Capabilities and constraints" and "Current documentation and asset work" (precedence 0); docs/ARCHITECTURE.md "Native browser startup readiness" (SPEC, 3)
- description: "The native Interlude route requires its real actor packages and world; its startup must report missing/failed resources rather than present procedural stand-ins." Reveal waits for terrain/camera attachment, native actor assembly, initial equipment, enabled flames and a ready frame; no fixed extra delay.
- acceptance: PRODUCT.md records 479 unit tests, staged build, five reveal cases each in Chromium and WebKit, corrected facing test as the state on that date.
- scope: native route startup.

## REQ-editor-authoring-preserved
- current: superseded by DEC-OWN-8. Babylon.js Editor is an optional viewer (VIEW-01, v2); the reproducible build is EDIT-02.
- source: PRODUCT.md (precedence 0); docs/ARCHITECTURE.md "One authored scene, two entry workflows" (SPEC, 3)
- description: "Static environment stays editable in Babylon.js Editor." Persistent world editing uses `native-world.scene` imported with `pnpm assets:editor`; generated assets must not overwrite saved Editor edits. docs/NATIVE_PARITY.md (SPEC, 4) requires an actual Babylon Editor 5.5.3 round trip, not an automated packer test.
- acceptance: PRODUCT.md: partial proof recorded (equipment, clip, camera, material tint/roughness, world placement); "Full native shader authoring and effect timing remain unfinished."
- scope: authoring.

## REQ-mobile-first-hud
- source: PRODUCT.md "Interface commitment" (precedence 0)
- description: "Mobile first. ... dark translucent panels, bronze borders, top-left health and bottom action controls. Preserve the original touch-friendly interface and do not copy reference screenshot pixels. Show actual screenshots at visible implementation milestones." Also: "Diagnostics and demonstration controls remain visible. All entity data is synthetic." (Phase 1 wording; docs/PORT_SCOPE.md part 5 records the current state as "Development sheet only".)
- acceptance: absent in source. Design tokens are in DESIGN.md (context.md).
- scope: HUD.

## REQ-phase1-foundation
- source: .planning/goal.md (PRD, precedence 2)
- description: Standalone Babylon.js + strict TypeScript client in logingrupa/l2-browser-client from Babylon.js Editor v5 Vanilla template; pnpm only (pinned, `pnpm-lock.yaml`), Vitest, Playwright; clear English identifiers, no `any`; adapt reusable rendering code from linegen after license review (SpacetimeDB, Evenfall gameplay and server simulation removed); `GameWorldAdapter` and `MockWorldAdapter`; one player, two simulated remote players, three NPCs/monsters; floating names and health bars; interpolation with teleport snapping; idle/run/attack; mouse targeting; spawn/despawn; FPS/entity count/coordinates. Document README.md, docs/ARCHITECTURE.md, docs/SOURCE_REUSE.md, docs/EDITOR_MCP.md. Fresh clone supports `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm test`.
- acceptance: "Run strict typechecking, build, Vitest and Playwright. Verify entity lifecycle, interpolation/teleports, camera/targeting, animation transitions, missing-asset fallback and absence of browser runtime errors. ... Document outcomes and unavailable checks honestly; never claim unperformed checks passed."
- scope: HISTORICAL. goal.md header: "Original foundation brief, retained for requirements and acceptance history. The implementation was pushed in commit `3b16f1c317e20ee636a3b3f83bddafc15096740a`." Its only bearing on work order is the scope boundary below and the pointer to "../docs/ROADMAP.md".

## REQ-phase1-scope-boundary
- source: .planning/goal.md, "Scope boundary" (PRD, precedence 2)
- description: "Use synthetic entities only. Exclude Mobius networking, Interlude packets, WebSocket relay, SpacetimeDB, gacha, real combat calculations, quests, progression, original L2 map conversion and production deployment." Future step 2, context only: Real M0 networking against stock Mobius.
- acceptance: absent in source.
- scope: Phase 1 only. Superseded in part by docs/PORT_SCOPE.md (precedence 1); see INFO entry in .planning/INGEST-CONFLICTS.md.

## REQ-parity-and-performance-acceptance
- source: PRODUCT.md "Rendering direction" (precedence 0, "Existing fidelity and hardware acceptance thresholds remain unchanged"); docs/NATIVE_PARITY.md (SPEC, 4); docs/RENDERING.md "Acceptance boundaries" (SPEC, 6)
- description: Native-parity visual acceptance on four cases (Human male fighter equipment/animation, Greater Musveren including death, Power Strike skill 3 with coordinated motion/effect, a declared representative section of `20_20.unr`) and a sustained 120 FPS target on DATABASE-PC's GTX 1060 at 1920 x 1080, DPR 1, with 32 actors and eight simultaneous Power Strike effects. PRODUCT.md adds that "Its RTX 4090 cannot certify the GTX 1060 target."
- acceptance: Defined in `recipes/native-parity.acceptance.json` (not in the prose) and summarized in constraints.md entries "Native parity fixed acceptance contract", "Native parity visual evidence rules", "Performance protocol and target". "Missing or uncertain evidence is **unverified**, never a pass." docs/NATIVE_PARITY.md states no pass has been claimed: capture cadence failed the fixed 30 FPS reference gate and no 120 Hz presentation display is available on the benchmark host.
- scope: fidelity and performance. Fixed thresholds apply to Phases 5-6; stage A uses the lighter per-part check (DEC-OWN-3).

## REQ-independent-system-scripts
- source: docs/ROADMAP.md "Current direction and next work" (DOC, 8); docs/ASSET_PIPELINE.md opening (SPEC, 5); docs/ASSET_BATCHING.md "Architecture" (DOC, unnumbered); docs/NATIVE_AUDIO.md (SPEC, 7)
- description: ASSET_BATCHING.md: "A selected system or asset must be convertible without running all extraction or other unrelated systems. Shared format readers, identity validation and packaging helpers may be reused; they are not a reason to require a monolithic command." The `assets:pipeline` orchestrator is "optional convenience for explicit jobs. Dedicated commands remain primary". ROADMAP.md: "Further orchestration is not the next milestone." Recipes select variants and source objects "without copying format readers for every race, building or tile."
- acceptance: absent as a test; ASSET_BATCHING.md records exit codes for the orchestrator (0 requested conversion coverage complete, 2 explicit partial coverage, 1 failure; "None means gameplay or native acceptance complete").
- scope: converter architecture. Relevant to PORT_SCOPE stage A item 2 ("one pipeline run over every tile"); DEC-OWN-7 sets tile-general converter steps with failing tiles listed as gaps.
