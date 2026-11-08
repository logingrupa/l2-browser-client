# Status

One line per part, in PORT_SCOPE section 5 order, rewritten in place by the integration thread. Format: part | lane | state | evidence doc. States are from PORT_SCOPE section 5 (2026-11-07). Lane ownership: `.planning/lanes.json`.

- data | data-ui | E: locked against IMPORTA-PC; 40-table inventory: 8 decoded locally, 29 layout only, 3 on the Elbera route | docs/parts/data/EVIDENCE.md
- sandbox | data-ui | by-ID spawn, equip, cast and open window with a missing-asset marker on NativeSliceAdapter; browser checks on the native sandbox route / only; dev cold start re-measured on PROMINENCE-PC and DATABASE-PC (first runtime module 39 s to 4-6 s, a first-run completion gap remains open) | docs/parts/sandbox/EVIDENCE.md
- world | world | 20_20 world section; WORLD-07 packet reviewed (74/74 re-hashed, 47 verdicts, owner review), layer-order and music-join fixtures in tests/fixtures/world-07 | docs/parts/world/EVIDENCE.md
- player-characters | actors | human fighters native, human mystic export in progress | docs/parts/player-characters/EVIDENCE.md
- ui | data-ui | development sheet only | docs/parts/ui/EVIDENCE.md
- npcs | actors | 1 (Greater Musveren) | docs/parts/npcs/EVIDENCE.md
- items | actors | not seen in the code | docs/parts/items/EVIDENCE.md
- skills-effects | actors | Power Strike in progress | docs/parts/skills-effects/EVIDENCE.md
- audio | actors | 20_20 footsteps, ambience and music in progress | docs/parts/audio/EVIDENCE.md
- minimap | world | not started | docs/parts/minimap/EVIDENCE.md
- movement-geodata | world | synthetic movement over WorldNavigation, no geodata files on DATABASE-PC | docs/parts/movement-geodata/EVIDENCE.md
- adapter-login | integration | not started | docs/parts/adapter-login/EVIDENCE.md
- adapter-dispatch | integration | 12-member sandbox command contract; shared Babylon-free modules, typed payload reader and source frame (02-56); packet dispatch not started | docs/parts/adapter-dispatch/EVIDENCE.md
- combat-display | integration | fighter versus Musveren demo | docs/parts/combat-display/EVIDENCE.md
- npc-dialogs | integration | needs part 13 | docs/parts/npc-dialogs/EVIDENCE.md
- shops-trade | integration | needs part 13 | docs/parts/shops-trade/EVIDENCE.md
- social | integration | needs part 13 | docs/parts/social/EVIDENCE.md
- quests | integration | needs part 13 | docs/parts/quests/EVIDENCE.md
- late-systems | integration | needs part 13 | docs/parts/late-systems/EVIDENCE.md
