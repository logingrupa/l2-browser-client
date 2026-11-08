# L2 Browser Client

A browser client for Lineage II Interlude on Babylon.js WebGPU, in strict TypeScript with pnpm. It converts the assets of the installed native client (world tiles, characters, NPCs, items, animations, skill visuals, audio, UI and the `.dat` tables) into `.l2asset` packages the browser loads. Each part is proven in an offline sandbox first. A replaceable server then plugs in through `GameWorldAdapter` (stock L2J Mobius first). The client never computes gameplay outcomes; it displays what a server sends.

Start here:

- [AGENTS.md](AGENTS.md): code and repo rules for anyone changing this repo.
- [.planning/PROJECT.md](.planning/PROJECT.md): what the project is, constraints and locked decisions.
- [PORT_SCOPE](docs/PORT_SCOPE.md): the measured scope of the port and the work split.
- [.planning/ROADMAP.md](.planning/ROADMAP.md): phases and work order.
- [.planning/STATE.md](.planning/STATE.md): current status and resume point.

<img src="docs/screenshots/mobile.png" alt="Mobile procedural foundation HUD with six synthetic characters, selected player and compact action controls" width="260" />

The image is the procedural foundation HUD at 390 x 844. [docs/screenshots/README.md](docs/screenshots/README.md) describes it. Converted-asset and native captures stay in ignored `artifacts/`.

## Setup

Prerequisites:

- Node.js 22.12.0 or later.
- pnpm 10.32.1, matching `packageManager` in `package.json`. Use pnpm for all dependency operations and keep `pnpm-lock.yaml`.
- A browser with WebGPU and hardware acceleration, over HTTPS or localhost. The client requires WebGPU.
- For conversion: Python 3.12 or later and the pinned local UE Viewer (UModel build1590).

```sh
pnpm install
pnpm dev
```

Open http://127.0.0.1:5173. Port 5173 is the default. A second checkout sets `DEV_PORT=<n>` in its gitignored `.env`; `pnpm dev` and Playwright both use that port.

`pnpm dev` and `pnpm build` stage the WebGPU shader compilers and then run Vite; no Editor step runs (DEC-OWN-8). The Editor is an optional viewer: `pnpm generate:editor` packs its scenes and `pnpm test:editor` runs the Editor-path tests. See [docs/EDITOR_VIEWER.md](docs/EDITOR_VIEWER.md).

## Routes

- `/?world=interlude`: the native `20_20` slice from the staged `.l2asset` catalog, with native Human players, Greater Musveren and live FPS. Required native assets fail startup visibly; there are no procedural stand-ins on this route.
- `/?world=interlude&character=<id>`: the same slice with a chosen player profile.
- `/`: the reference Talking Island route on a code-built scene when its lineagen-derived world is staged locally, otherwise the same scene with mock actors and the status "Reference world not staged". The `public-without-lineagen-media` plugin in `vite.config.ts` keeps `public/assets/world/` and `public/assets/characters/` out of `dist/`, so a build's `/` shows the not-staged status and nothing from lineagen ships.

The **Dev** button opens the developer sheet: docked beside or below the canvas, or as an overlay, tabbed, with a filter and hover-cards that list each control's live variables, values, source and native-or-presentation status. On the native route it changes upper-body item 22, plays, holds and revives Musveren's death, frames the world, follows the fighter, switches between source-texture preview and neutral terrain, and sets audio levels. One trusted tap starts the `20_20` MusicVolume music, the map ambience, gait-driven footsteps and the attack and hit sounds. [docs/NATIVE_AUDIO.md](docs/NATIVE_AUDIO.md) records which rules are native evidence and which are labelled presentation choices.

The private preview and its access rules are in [docs/PRIVATE_PREVIEW.md](docs/PRIVATE_PREVIEW.md).

## Stage converted assets

Converted binaries stay local in ignored `public/l2/` and `artifacts/`. Never commit or publish them.

```sh
pnpm assets:migrate --stage-runtime
pnpm assets:stage
```

`pnpm assets:migrate --stage-runtime` stages the native world section. `pnpm assets:migrate --prove-rebuild` also checks cache replay and a clean rebuild; [docs/NATIVE_MIGRATION.md](docs/NATIVE_MIGRATION.md) covers inputs, recipes and outputs.

`pnpm assets:stage` runs `scripts/stage_native_players.py` with `recipes/native-player-mystics-stage.json` and `recipes/native-player-aliases-stage.json`. It stages the four native Interlude Human exports (MFighter, FFighter, MMagic, FMagic) into `public/l2/player-profiles/`. It adds hash-pinned packages and profiles to `public/l2/catalog.json` without replacing the world catalog, refuses to overwrite, and repeats with zero writes.

Models keep native scale: the exporter's 0.01 m per source unit, the actor's DrawScale and the collision radius and height from class data. There is no height fitting, recentering or grounding repair. Every model binds 45 of the browser's 46 animation aliases. `damage` has no source clip: no class section assigns `DamageAnimName` and Interlude has no hit-reaction clip. `Damagefly_<Class>` (`DamageFlyAnimName`) is a knock-back and is never substituted. Open **Dev > Character > Animation aliases** on `/?world=interlude&character=<id>` to list and play them.

## Convert assets

IMPORTA-PC `C:/Lineage2-client` is the native reference, and all L2.exe comparisons run there. DATABASE-PC `E:/Lineage2-client` is a conversion source only after the full-tree hash lock (DEC-OWN-2).

```powershell
pnpm assets:convert --kind model --package speaking1f_s --object wall03
pnpm assets:convert --kind audio --media music/b01_f.ogg
pnpm assets:batch recipes/native-mfighter.json --client artifacts/native-parity/inputs/IMPORTA-PC
pnpm assets:catalog --client artifacts/native-parity/inputs/IMPORTA-PC --output artifacts/native-client-audit/catalog.json
```

Each conversion prints the path to a verified, self-contained `asset.l2asset`. Drop it onto the client, or open **Dev > Debug > Asset inspector** on a native route, to inspect it at its recorded scale, play its clips or hear its audio. Unresolved native materials show as visible diagnostics.

More scripts: `assets:pipeline` (optional orchestrator), `assets:effects`, `assets:ambient`, `assets:sounds`, `assets:verify`, `test:pipeline`. Scripts that write the native store run only in the main checkout (see [.planning/PROJECT.md](.planning/PROJECT.md)). [docs/ASSET_PIPELINE.md](docs/ASSET_PIPELINE.md) covers recipes, assemblies, texture bindings and supported formats.

## Build and test

```sh
pnpm typecheck
pnpm build
pnpm serve
```

`pnpm build` runs strict TypeScript checking and writes `dist/`. It copies `public/` except `public/assets/characters/` and `public/assets/world/`. `pnpm serve` previews the build locally. No production deployment is configured.

```sh
pnpm test:setup
pnpm test
```

`pnpm test:setup` installs the Playwright Chromium browser once. `pnpm test` runs Vitest (`pnpm test:unit`) and then Playwright (`pnpm test:e2e`). Playwright starts its own `pnpm dev` on 5173, or on `DEV_PORT` from `.env`; stop a manually started dev server on that port first. Chromium uses SwiftShader WebGPU unless `WORLD_HARDWARE_TEST=1` selects the machine's normal GPU. Failure traces go to `test-results/`.

Run `pnpm assets:stage` and `pnpm assets:migrate --stage-runtime` before the native browser suites. Checks that need staged packages skip explicitly when the packages are absent; a procedural fallback never counts as a successful import. Run builds and browser tests one at a time.

The terrain GPU diagnostic runs with `pnpm exec playwright test --config playwright.terrain.config.ts`. Recorded results are in [docs/VERIFICATION.md](docs/VERIFICATION.md).

Pinned stack: Babylon.js 9.27.1, TypeScript 7.0.2, Vite 7.3.7, Vitest 5.1.0, Playwright 1.64.1, Editor tools and CLI 5.5.3 (optional viewer only). The exact graph is in `pnpm-lock.yaml`.

## Docs map

- [PORT_SCOPE](docs/PORT_SCOPE.md): measured scope of the port, stages and lanes.
- [ARCHITECTURE](docs/ARCHITECTURE.md): ownership, the `GameWorldAdapter` boundary, units and timing.
- [RENDERING](docs/RENDERING.md): rendering and performance direction.
- [ASSET_PIPELINE](docs/ASSET_PIPELINE.md): conversion scripts, recipes and the `.l2asset` contract.
- [NATIVE_MIGRATION](docs/NATIVE_MIGRATION.md): repeatable native migration and its inputs lock.
- [NATIVE_CLIENT_AUDIT](docs/NATIVE_CLIENT_AUDIT.md): reference client identity, formats and decoders.
- [NATIVE_TEXTURES](docs/NATIVE_TEXTURES.md): native texture, mip and DDS products.
- [NATIVE_WORLD](docs/NATIVE_WORLD.md): the native `20_20` world preview.
- [NATIVE_BSP_FLOOR](docs/NATIVE_BSP_FLOOR.md): BSP geometry conversion on `20_20`.
- [NATIVE_SKY](docs/NATIVE_SKY.md): the original `20_20` sky.
- [NATIVE_FLAMES](docs/NATIVE_FLAMES.md): the flame presentation.
- [NATIVE_DOOR_MOVERS](docs/NATIVE_DOOR_MOVERS.md): native doors and gates.
- [NATIVE_NPC_PROFILES](docs/NATIVE_NPC_PROFILES.md): NPC presentation profiles from native tables.
- [NATIVE_POWER_STRIKE](docs/NATIVE_POWER_STRIKE.md): Power Strike source migration and previews.
- [NATIVE_AUDIO](docs/NATIVE_AUDIO.md): audio acceptance, native rules and presentation choices.
- [NATIVE_PARITY](docs/NATIVE_PARITY.md): fixed parity contract and performance protocol.
- [VERIFICATION](docs/VERIFICATION.md): recorded test and capture results.
- [SOURCE_REUSE](docs/SOURCE_REUSE.md): provenance and licences (`NOTICE` points here).
- [LINEAGE2ELBERA_REUSE_AUDIT](docs/LINEAGE2ELBERA_REUSE_AUDIT.md): what to reuse from Lineage2Elbera.
- [WORLD_ASSETS](docs/WORLD_ASSETS.md): provenance of the lineagen-adapted `src/scene/world/` modules.
- [EDITOR_VIEWER](docs/EDITOR_VIEWER.md): the optional Babylon.js Editor viewer.
- [PRIVATE_PREVIEW](docs/PRIVATE_PREVIEW.md): the private preview host.
- [genericity-audit-20261108](docs/research/genericity-audit-20261108.md): how generic the `20_20` world build is.

The game interface is the original Interlude interface only (DEC-OWN-10); see [PRODUCT.md](PRODUCT.md).

## Licences

No Lineage II binaries, captures or native audio are committed or published. The Editor template and Babylon.js are Apache-2.0 and Cormorant Garamond is SIL OFL 1.1 (`LICENSE`, `NOTICE`, `docs/licenses/`). The published foundation copies no `linegen` source or assets; five lineagen-adapted world modules await owner review ([docs/WORLD_ASSETS.md](docs/WORLD_ASSETS.md)). Details: [docs/SOURCE_REUSE.md](docs/SOURCE_REUSE.md).
