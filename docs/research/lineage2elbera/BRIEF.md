# Lineage2Elbera tool investigation brief

Task: inspect every listed upstream tool area using a separate investigator,
then independently refute the proposed reuse decisions. Research only; do not
change application behavior, native inputs, generated assets, or existing work.

Upstream checkout: `C:/laragon/www/Lineage2Elbera-reference`.
Pinned commit: `12c9656e2f053b233ec3fd87056491a6a6da8b0c`.
Repository: https://github.com/elberacasa/Lineage2Elbera
Client checkout: `C:/laragon/www/l2-browser-client`.
Read upstream `AGENTS.md` and `LICENSE`. Its authored code is MIT; bundled
third-party components and native game data have separate rights.

Client context: Babylon.js 9.27.1, WebGPU required, TypeScript/Vite, Babylon
Editor 5.5.3. Local Python conversion pipeline already preserves source hashes,
native geometry/animation/material metadata, deterministic products and cache
receipts. Existing native Interlude packages include UE123/licensee30 and a
bounded UE118 map path. Fidelity means source appearance and behavior with a
modern renderer; legacy details matter when they explain visible differences.
Audio and animation event policy, materials/effects, broad world coverage,
performance, collision and networking remain incomplete.

Read relevant local source, not just the README. Useful context files:
`docs/RENDERING.md`, `docs/ASSET_PIPELINE.md`, `docs/NATIVE_AUDIO.md`,
`docs/CONVERSION_TOOLING_AUDIT.md`, `docs/SOURCE_REUSE.md`, `package.json`.
Local `scripts/vendor/lineage2elbera_bsp/SOURCE.json` already pins selected
upstream readers at this SAME commit. Do not claim there is no existing reuse.
Existing uncommitted work is extensive; do not overwrite or revert it.

Each assigned investigator must inspect the complete filename inventory of
their area, group its tools, and deeply read the relevant implementations.
Write only the specifically assigned report. Do not spawn subagents.
Aim for 400–700 words; large areas may use 900. Include:

1. Actual purpose and tool families, with concrete upstream `path:line` evidence.
2. Inputs, outputs, dependencies and portability; distinguish standalone tools
   from repository-specific pipelines, browser inspectors and native verifiers.
3. Overlap/gaps against concrete local source paths and symbols.
4. Reuse verdict: reuse directly / adapt / reference only / defer, identifying
   specific candidates rather than recommending whole-directory copying.
5. Smallest useful integration/proof, its acceptance evidence and remaining risks.
6. What was actually executed versus merely inspected. Never count upstream
   README claims as checks you performed. Source-only inspection is acceptable.

Prefer bounded, portable synthetic tests only after checking their behavior.
Do not run native binaries, mutate private assets, install dependencies, start
servers, publish, deploy, or run the full upstream battery. Report unavailable
dependencies or private fixtures explicitly. No speculative license warnings:
identify the actual applicable license and any concrete exception.

Reports are source-based technical recommendations, not proof of full browser
parity. Separate source-record equality, arithmetic equivalence, rendered
appearance and integrated runtime behavior. Avoid reimplementing an existing
tool solely to match our repository layout.
