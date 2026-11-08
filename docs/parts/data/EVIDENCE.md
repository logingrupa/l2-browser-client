# Asset and .dat decoders evidence

Part `data`, lane `data-ui`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

Nothing has passed the stage A check yet (DEC-OWN-3). Working on 2026-11-07, per PORT_SCOPE section 5: The UE Viewer route works on a pinned input snapshot. 11 of 40 `.dat` tables are decoded to JSON, by Elbera's tools.

## Open

40 `.dat` tables, 25 `.u`, 435 `.utx`, 212 `.usx`, 20 `.ukx` and 163 `.unr` packages. The combined decoded-table inventory comes first (FOUND-04), then all 40 tables through the local descriptor or Elbera behind an adapter (DATA-01, DATA-02) and the sysstring-e / systemmsg-e count question (DATA-03).

## Evidence

Decoder code: `scripts/native_catalog/`. Input pin: `recipes/native-inputs.lock.json`.
