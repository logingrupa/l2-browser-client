/lane

Read and follow the installed /lane skill first. Preserve tool ownership and resource limits from the brief. If unavailable, say so.

Continue the existing terrain investigation; reuse its evidence and tools.

GOAL
Resolve the exact native behavior needed to fix the imported 20_20 terrain in Babylon.js. Deliver an evidence-backed, implementation-ready correction to the browser agent. Prioritize one justified visible correction over completing every reverse-engineering question. Do not assume UVs explain all terrain defects.

PROJECT
DATABASE-PC: C:\laragon\www\l2-browser-client
Native reference: IMPORTA-PC, C:\Lineage2-client
Keep browser code changes owned by the browser agent.

READ FIRST (relative to the project root)
1. .planning/terrain-reverse-engineer-brief-20261106.md
2. artifacts/native-parity/research/terrain-uv-reference-20261106/REPORT.md
3. Under artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/:
REPORT.md, EVIDENCE_DEPENDENCIES.md, DRAW_PACKET.md, COORDINATE_BINDING_ADDENDUM.md, native/UV_PRODUCER.md.
Read newer checkpoints before repeating work.

NEW BROWSER EVIDENCE
44 synthetic GPU cases pass on GTX 1060, including 24 UV cases; 12 focused unit tests pass. A separate CPU audit of nine real masks finds seven differ between the two formulas, entirely beyond grid Y240. These are conditional tests/source sensitivity, not native parity or proof of the active branch.

The retained section is X64..112/Y208..255 on a 256x256 heightmap. All 2,352 exported UV pairs match:
ordinary = (grid + 0.5) / heightmapDimension
alternative = ordinary - max(grid - 240, 0) / 4096
At Y255: 0.998046875 versus 0.994384765625.

PRIORITY
Find the smallest qualifying exact-client observation for a mapped terrain vertex above Y240. Retain capture/module hashes, section/draw identity, actual vertex bytes/declaration/stride, effective mask coordinate and transform state, material route, bound mask identity, and active shader identity/bytecode where applicable.

Static globals/defaults are insufficient: the stream may have been generated earlier, pass transfer can select TEXCOORD1, and cached state can survive. Prove the effective sampled coordinates. Identify which formula applies to that draw, or prove why neither prediction describes it.

Use existing captures first. Do not repeat exhausted broad scans. If none qualifies, prepare one concrete minimal capture plan: compatible D3D9 tool/version, host, exact observation, commands, required runtime changes and cleanup. Existing restrictions on new native capture/runtime manipulation remain; identify the precise additional authorization needed rather than silently running it or continuing unproductive scans.

FOLLOW THROUGH
Once one behavior is proved, immediately hand over:
- Source hashes and instruction/capture anchors.
- The applicable predicate and expected bytes/values.
- Exact affected converter/runtime/saved Editor paths.
- Smallest correction and a case that fails before and passes after.
- Before/after validation instructions and remaining unknowns.
If ordinary UVs are correct, explicitly rule out changing them and identify the next evidence-backed cause.

Do not wait for unrelated shader or bUseAlpha questions before handing over a supported correction. Pursue bUseAlpha only from a positive read/copy anchor. Keep CPU GetLayerAlpha classification separate from GPU sampling; preserve ordinary BC1 decoding.

Preserve native files, protected l2.ini, Jump Fluid, authored Editor edits, source assets and acceptance tolerances. No service changes, deployment or publishing. Babylon may use a modern implementation with demonstrated equivalent results; optimization follows a verified baseline.

1:1 INCLUDES AUDIO. Read docs/NATIVE_AUDIO.md; preserve sound/region/emitter metadata and report audio gaps. Browser owner handles integration. Save BROWSER_FIX_HANDOFF.md on DATABASE-PC. No overall parity, performance or Phase 2 claim.
