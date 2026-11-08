# Server adapter: event dispatch evidence

Part `adapter-dispatch`, lane `integration`. What passes now, what is open, and where the proof lives. Keep this file under about 30 KB.

## Passes now

- The sandbox command contract has 12 WorldCommand members, adding `spawn-character` (chargrp template index) and `play-clip` (entity id and exact clip name) in plan 02-10 and dropping the courtyard-only `teleport-local` and `spawn` with `MockWorldAdapter` (DEC-OWN-11). `NativeSliceAdapter`, the only adapter, dispatches exhaustively with a `never` default. Evidence: `tests/unit/gameWorldAdapterContract.test.ts` and `tests/unit/sandboxCommands.test.ts`.

## Open

215 / 279 packets on Mobius dispatched one packet type at a time into typed adapter events with golden fixtures (NET-04). Conditional SpacetimeDB adapter (NET-08).

## Evidence

None recorded yet.
