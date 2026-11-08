# Movement display and geodata evidence

Part `movement-geodata`, lane `world`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

Nothing has passed the stage A check yet (DEC-OWN-3). Working on 2026-11-07, per PORT_SCOPE section 5: Synthetic movement over `WorldNavigation`.

## Open

Geodata and 547 doors. No geodata files exist on DATABASE-PC; real geodata-backed movement is GEO-01 (v2). Walking converted tiles with terrain collision is WORLD-05.

## Evidence

Code: `src/world/WorldNavigation.ts`, `src/world/syntheticMovement.ts`.
