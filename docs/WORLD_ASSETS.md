# Lineagen-adapted world modules

Provenance for five modules in `src/scene/world/` whose header comments cite this doc. Only `loadImportedWorld.ts` imports them, so they serve only the reference Talking Island route (`/`), not the native route. Decisions and work order: [PROJECT.md](../.planning/PROJECT.md) and [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- Each module adapts code from the local lineagen workspace `C:/laragon/www/lineagen/terrain-previews/` (read only), without its UI, networking or converters:
  - `foliageCutout.ts`: alpha-test cutout at 0.5 on four named leaf materials of two hash-pinned tree models. It is an approximation because the source shader is not recovered.
  - `terrainSurfaces.ts`: source-layer terrain surfaces (`source-layers-v2`) with an explicit baked fallback whose reason goes to diagnostics.
  - `grassInstances.ts`: grass thin instances from the staged grass placement files.
  - `worldVisibility.ts`: visibility hysteresis near the streaming boundary.
  - `sourceColliderPolicy.ts`: two exact placements keep their source-disabled colliders. Unknown placements keep the triangle collider.
- `pnpm world:stage` (`scripts/stage-world-assets.mjs`) copies hash-pinned files from `<lineagen>/.assets/talking-island` (default root `C:/laragon/www/lineagen`) into ignored `public/assets/world/`. A missing or changed pinned file stops staging. The pins live in the script. `pnpm world:verify` checks the staged copy without writing.
- `world:stage` writes the store, so only the integration thread runs it (AGENTS.md).
- `pnpm build` never copies `public/assets/world/` or `public/assets/characters/` into `dist/` (`public-without-lineagen-media` in `vite.config.ts`, tested by `tests/unit/viteBuildPublic.test.ts`).
- Conversion review evidence: `artifacts/native-parity/research/world-conversion-review/README.md` and `audit.json`.

## Open

- DEC-SRC-1 forbids copied `linegen` source and no redistribution licence is known ([SOURCE_REUSE.md](SOURCE_REUSE.md)). These modules are lineagen-adapted, and no redistribution grant is asserted for them or the staged data. The owner decides whether they stay, get rewritten independently or leave with the reference route.
- `sourceColliderPolicy.ts` cites `docs/WEAPONS_SHOP_DOORWAY.md`, which does not exist.
- Unverified: a blinking report on this route needs a check on a physical iPhone.
