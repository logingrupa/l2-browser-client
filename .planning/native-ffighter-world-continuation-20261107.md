# Current human/world continuation

The broad Interlude browser/Editor/asset/audio goal is ACTIVE. Latest user
steering takes precedence over earlier expansion recommendations:

- Small dedicated independently runnable scripts per system; optional batch
  orchestration may compose them. Separate commands are intentional.
- Finish human male/female and their class skills before further races. The
  current human fighter recipes do not cover mystics or every class/skill.
- Finish usable current 20_20 traversal before more map tiles. The user reports
  stairs inside a building; an initial outdoor selection was immediately
  clarified. Test indoor stairs and preserve earlier floor receipts as scoped.
- Actor/animation/skill/enemy conversion carries original resolvable sound
  dependencies and event timing. Explicitly report unresolved dispatch/lookup.
  Actual world playback remains required; exported audio is not audible gameplay.

Current checkpoint root:
`artifacts/native-parity/research/native-ffighter-world-20261107/`.
Read its `REPORT.md`, `FINAL_RECEIPT.json` and `FINAL_MANIFEST.json` rather than
inferring completion from this working note. `BASELINE.json` predates current edits and pins 2,311
paths including the intentionally changed catalog, plus 143 original inputs.

Female assembly conversion is already closed in `native-ffighter-expansion-20261107`:
reuse archive ce3984dd...; do not repeat its conversion or 4,773-sound corpus.
The dedicated `scripts/stage_native_players.py` adds immutable packages/profile
manifests while preserving other catalog records. Actual recipe is
`recipes/native-player-ffighter-stage.json`. Staged catalog is 69e99a2a09ee6628839e93126c7842916a34f54b615dc95136f37baed3333c9c.
Both source/authored selection use `character=human-female-fighter`; the default
male retains existing authored clip settings. This is startup selection.
Four female death events have exact original source/WAV joins; six specialized
attack events remain uncovered. Browser verification must not infer attack audio.

Dedicated stair investigation is in
`artifacts/native-parity/research/native-stair-traversal-20261107/`.
Read its parent `IMPLEMENTATION.md`, `FINAL_RECEIPT.json` and
`CHECKPOINT-MANIFEST.json`. The independent `REPORT.md` remains the frozen
source/CPU diagnosis. The old helper admitted only BSP plus Actor940; the
repair separately admits explicit collision-enabled static sections, preserving
strict BSP relationships, authored exclusions and effect/animation exclusions.
All four final male/female source/authored hardware WebGPU cases pass supplied
waypoint ascent/descent, a real lower-ramp click, blocked direct-turn control,
return to spawn and cleanup. Both male cases retain the historical floor/wall
control, now using the source-qualified Actor1046 contact oracle at actual XZ.
Existing numeric tolerances and geometry remain unchanged; no rerun is needed.
The 59 focused support tests, final build/typecheck and preservation pass.

Limits remain: the controller does not plan routes around turns, the upper
camera can be occluded by the roof, and one initial device-loss failure has no
established cause. Final cases have no observed GPU errors/loss. Earlier female
pointer-limited attempts and failed contact/device-loss cases remain intact.
The lower-ramp screenshots were inspected; upper telemetry is not a clear
upper-landing pixel proof. Do not call this complete 20_20 traversal or parity.

Preserve the current 62 scenery models/157 placements, all saved transforms and
materials, geometry549a7fef..., primaryUVd549356f..., UV24c6a9644..., original
source bytes and acceptance tolerances. WebGPU hardware is required, with full
Playwright Chromium and no GPU override flags. No service/deployment/native
runtime/capture/query/injection/replay authority. Networking stays planned.

Next: use `HUMAN_COVERAGE.json` / `HUMAN_NEXT.md` for the retained human
class/skill/footstep gaps. Bundle the 20 exact StepSound dependencies already
present in the completed corpus, preserving ordered surface arrays, duplicates,
event times and fully qualified identities for both fighters. Use a small
dedicated dependency tool; no new full-corpus export or unique-leaf alias.
Then integrate loop-aware playback with explicit source-selection limits and
test transitions/interruption/disposal. Other human bases/classes and skill
dispatch remain open. Do not move to another race/tile simply because conversion
works. Keep original music, ambience, voices, combat/skills and UI in acceptance.

Before the next audio/skill slice read
`artifacts/native-parity/research/elbera-alignment-20261107/REPORT.md`,
`ALIGNMENT_ASSETS.md` and `ALIGNMENT_REFUTER.md`. The existing 22-tool audit and
later alignment checks are complete; do not duplicate them. Reuse selectors
selectively, retaining original global row ordinals and raw references beside
per-skill groups or lowercased derivatives. Do not copy `build_stepnotify`'s
two-step expectation or rounded timing. Later streaming lifecycle helpers do
not supersede the current human/audio/traversal order.
