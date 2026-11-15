# L2 browser client

A browser client for Lineage II Interlude on Babylon.js WebGPU (strict TypeScript, pnpm). It converts the installed native client into `.l2asset` packages plus a runtime catalog, proves each part in an offline sandbox, then takes gameplay state from a replaceable server through `GameWorldAdapter`.

Truth lives in [AGENTS.md](AGENTS.md) and `.planning/` ([PROJECT.md](.planning/PROJECT.md), [REQUIREMENTS.md](.planning/REQUIREMENTS.md), [ROADMAP.md](.planning/ROADMAP.md), [STATE.md](.planning/STATE.md)). Part status: [STATUS.md](STATUS.md). Dated decisions: [DECISIONS.md](DECISIONS.md).

## Setup and commands

Node.js 22.12.0 or later, pnpm 10.32.1, a WebGPU browser. Conversion also needs Python and the pinned UModel build1590.

- `pnpm install`, then `pnpm dev` (http://127.0.0.1:5173, or `DEV_PORT` from `.env`).
- `pnpm typecheck`, `pnpm test:unit` (Vitest), `pnpm test:e2e` (Playwright, starts its own `pnpm dev`), `pnpm test` (both), `pnpm test:pipeline` (Python pipeline tests). `pnpm test:setup` installs Chromium once.
- `pnpm build` writes `dist/`, `pnpm serve` previews it.
- Optional Editor viewer: `pnpm generate:editor`, `pnpm test:editor`.
- Lane converters: `pnpm convert:tables`, `convert:world`, `convert:actors`, `convert:ui`, each with `--client <reference client>` and its single-unit selector (for example `pnpm convert:world --client E:/Lineage2-client --map 20_21 --step raw`). pnpm 10 forwards a `--` to the script, so leave it out. They write only to `artifacts/lane-store/<lane>/l2`; restaging the shared store is a Needs Human merge.
- Native store writers (`assets:*`) run only in the main checkout.

Headless e2e uses SwiftShader, so its FPS is not a measurement. Phone screenshots: iPhone 15 Pro Max landscape, 932 x 430 (DEC-OWN-9).

## Routes

`/` is the native 20_20 sandbox from `public/l2/`. Add `?character=<id>` for a staged player profile or `?authored=1` for the optional Editor export. How each route loads and fails: [ARCHITECTURE](docs/ARCHITECTURE.md).

## Docs

- [PORT_SCOPE](docs/PORT_SCOPE.md): scope, stages, parts.
- [OUTPUT_CONTRACT](docs/OUTPUT_CONTRACT.md): `.l2asset` and catalog.
- [parts/](docs/parts/): `EVIDENCE.md` per part.
- [research/INDEX.md](docs/research/INDEX.md): rated research.
- [ARCHITECTURE](docs/ARCHITECTURE.md): routes, adapter, invariants.
- [RENDERING](docs/RENDERING.md): rendering, performance.
- [ASSET_PIPELINE](docs/ASSET_PIPELINE.md): conversion scripts, recipes.
- [NATIVE_MIGRATION](docs/NATIVE_MIGRATION.md): repeatable migration.
- [NATIVE_CLIENT_AUDIT](docs/NATIVE_CLIENT_AUDIT.md): reference client, formats.
- [NATIVE_TEXTURES](docs/NATIVE_TEXTURES.md): textures.
- [NATIVE_WORLD](docs/NATIVE_WORLD.md): 20_20 world.
- [NATIVE_BSP_FLOOR](docs/NATIVE_BSP_FLOOR.md): BSP.
- [NATIVE_SKY](docs/NATIVE_SKY.md): sky.
- [NATIVE_FLAMES](docs/NATIVE_FLAMES.md): flames.
- [NATIVE_DOOR_MOVERS](docs/NATIVE_DOOR_MOVERS.md): doors, gates.
- [NATIVE_NPC_PROFILES](docs/NATIVE_NPC_PROFILES.md): NPC profiles.
- [NATIVE_POWER_STRIKE](docs/NATIVE_POWER_STRIKE.md): Power Strike.
- [NATIVE_AUDIO](docs/NATIVE_AUDIO.md): audio.
- [NATIVE_PARITY](docs/NATIVE_PARITY.md): parity thresholds.
- [VERIFICATION](docs/VERIFICATION.md): test and capture results.
- [EDITOR_VIEWER](docs/EDITOR_VIEWER.md): optional Editor viewer.
- [PRIVATE_PREVIEW](docs/PRIVATE_PREVIEW.md): private preview.
- [SOURCE_REUSE](docs/SOURCE_REUSE.md): provenance.
- [LINEAGE2ELBERA_REUSE_AUDIT](docs/LINEAGE2ELBERA_REUSE_AUDIT.md): Elbera reuse.

## Licences

No Lineage II binaries, captures or audio are committed. Third-party licences: [LICENSE](LICENSE), [docs/licenses/](docs/licenses/). Template and code provenance: [SOURCE_REUSE](docs/SOURCE_REUSE.md).
