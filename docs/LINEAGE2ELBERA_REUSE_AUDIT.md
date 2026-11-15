# Lineage2Elbera reuse audit

What this client may take from Lineage2Elbera `tools/` at commit `12c9656` (MIT, full pin in [SOURCE_REUSE.md](SOURCE_REUSE.md)). Decisions and work order: [PROJECT.md](../.planning/PROJECT.md) and [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- The audit covers the 406 tracked files under upstream `tools/` ([inventory.json](research/lineage2elbera/inventory.json)), not `gateway/` or the world-server `editor/`.
- Before writing a decoder, check upstream and the local equivalent. Reuse pinned upstream functions behind a small adapter with licence, source hashes and an independent test, like `scripts/vendor/lineage2elbera_bsp/`.
- Per DEC-OWN-4 a local descriptor layout wins and Elbera fills gaps (DATA-02), so `tools/dat/export_quests.py` only cross-checks the local `questname` layout.
- Candidates: `tools/xdat/parse_xdat.py` (UI-01), `tools/world/terrain_topology.py` and `terrain_edges.py` (WORLD-03), `tools/maps/build_minimap.py` (WORLD-06), `tools/anim/build_npc_variants.py` (ACT-02). `tools/playtest/session.test.mjs`: cross-check for the NET-09 replay harness, not a port.
- Do not adopt pipelines that drop data this client keeps (CONV-02): `tools/world/bsp.py`, `convert.py`, `tools/src/char_pipeline/assemble.py` (package declares ISC, not MIT), `tools/audio/build_audio.py`.
- Never use upstream verifiers pinned to Engine.dll `07b24af4...`; this client's is `4dd2f63c...`.
- `hairgrp`, `helmetgrp` and `hairaccessarygrp` decode through Elbera's `hair_pairs` and `keyed_hair_pairs`. Their int32 reading equals the client layout of the 4dd2 Engine.dll loaders ([data evidence](parts/data/EVIDENCE.md), [inventory](parts/data/dat-table-inventory.json)). `keyed_hair_pairs` lives in an Engine-pinned verifier; take the parser only (DATA-02, ACT-01).
- Keep global row ordinals and raw references beside per-skill groups. Do not copy the two-step expectation or rounded timing of `tools/audio/build_stepnotify.py` (DATA-02, ACT-05, ACT-06).

## Open

- Audit `gateway/` and `editor/` as references (NET-03).
- `Interface.xdat` is missing from `recipes/native-inputs.lock.json`. `parse_xdat.py` byte coverage is not decode completeness (UI-01).
- Settle on native evidence: equal adjacent key times (ACT-04), bone binding by first name or by parent and name. Elbera's sky probes assume BGRA; serialized FColor is RGBA ([NATIVE_SKY.md](NATIVE_SKY.md)), and the live color writer's order is open (WORLD-02).
- `tools/world/bsplight.py` overreads a synthetic export; it and `lightmap.py` need bounded reads (polish, DEC-PORT-5).

## Pointers

- `artifacts/native-parity/research/elbera-alignment-20261107/` (local, [research/INDEX.md](research/INDEX.md)); its slice-first order is overruled by DEC-OWN-1.
- [PORT_SCOPE.md](PORT_SCOPE.md) section 9. Per-tool verdicts: git history.
