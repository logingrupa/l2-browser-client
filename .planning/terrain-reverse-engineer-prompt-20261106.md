Resume the existing terrain reverse-engineering goal; do not create a duplicate investigation.

Read the detailed brief on DATABASE-PC:
C:\laragon\www\l2-browser-client\.planning\terrain-reverse-engineer-brief-20261106.md
It contains the evidence links, exact branch predicates, tool limits and deliverables.

GOAL
1:1 includes original Interlude audio. Read docs/NATIVE_AUDIO.md; preserve sound/region/emitter metadata and report unresolved audio rules. Browser owner handles integration; keep terrain moving. Inspector-only playback cannot pass overall parity.

Recover the exact-client evidence needed to choose the correct 20_20 terrain coordinates, layer composition and material behavior in our Babylon.js client. Deliver a small, justified browser correction specification with discriminating tests, or identify the precise missing observation and prepare the smallest concrete way to obtain it. Decompiled-function counts are not the goal.

CURRENT FACTS
Seven native analysis batches are complete. Both UV producers and their conditional legacy binding are proved:
ordinary = (grid + 0.5) / heightmapDimension
corrected = ordinary - max(grid - 240, 0) / 4096
Our selected section is X64..112/Y208..255. Its 2,352 exported UV pairs match the ordinary formula. Actual generated native vertices, effective coordinate state and bound resources remain unobserved. Static defaults cannot choose the active branch.

All 81 retained diffuse BC1 mips are opaque. Diffuse-alpha multiplication is therefore an identity for unchanged inputs, but this does NOT settle the separate transparency predicate used for CPU geometry pruning. Preserve ordinary BC1 and keep GetLayerAlpha classification separate from GPU sampling. The exact selected shader and bUseAlpha consumer remain unknown.

CHASE THESE DEPENDENCIES
1. Find an existing qualifying 20_20 draw/resource capture, including outside the already-searched folders. Record search coverage and rejected candidates. Minimum UV evidence: mapped vertex above Y240, vertex bytes/declaration/stride, effective mask coordinate/transform state, material route, active shader objects and bound mask identity.
2. Recover exact selected shader/cache bytes with material, flags and binding provenance. Public sources or Manus, if available, may provide leads; verify version/hash relevance. A different client's shader, filename, screenshot or missing file does not prove our client's behavior.
3. Pursue bUseAlpha only from a positive read/copy anchor at TerrainInfo+0x4b4+layerIndex*0xe8, mask 1, then follow both outcomes to rendering. Do not repeat exhausted broad scans or infer non-use.
4. If no capture exists, prepare a concrete minimal capture proposal: compatible tool/version and D3D9 support, host, capture mechanism, exact fields, required runtime changes, interference risks and cleanup. Do not execute restricted runtime actions.

WORKING RULES
Reuse pinned tools, receipts and the existing single REA owner/resource limits. No overall time limit; keep individual queries bounded. Preserve native files, protected l2.ini, Jump Fluid, Editor edits, source assets and acceptance tolerances. Existing restrictions on native runtime manipulation, service changes and production deployment remain in force. Keep binaries, private captures and credentials local. Ask only for an exact missing decision after preparing reviewable evidence or a concrete capture proposal.

DELIVER
Save additive evidence and a concise browser handoff on DATABASE-PC, with source hashes, instruction anchors, predicates, reproducible commands, tiny distinguishing cases and unresolved questions. Separate native facts from Babylon recommendations. Prioritize a visible, justified correction; do not reproduce obsolete native architecture unnecessarily. Optimization is a later measured experiment. Report progress and actual coverage without claiming native parity, 120 FPS, full-client completion or Phase 2 networking.
