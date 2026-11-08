# Offline sandbox evidence

Part `sandbox`, lane `data-ui`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

Nothing has passed the stage A check yet (DEC-OWN-3). Working on 2026-11-07, per PORT_SCOPE section 5: `MockWorldAdapter` and `NativeSliceAdapter` exist.

## Open

Spawn NPC, equip item, cast skill and open window by ID without a server, with an explicit missing-asset diagnostic (SAND-01). Pinnable developer sheet with hover-cards (SAND-02).

## Evidence

Adapters: `src/world/MockWorldAdapter.ts`, `src/world/NativeSliceAdapter.ts`.
