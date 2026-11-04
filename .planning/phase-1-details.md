# Phase 1 implementation requirements

This file supplies the full requirements for [the main implementation prompt](goal.md). Read both before implementing. This planning task only prepares the prompt; implementation, commits and pushes described below belong to execution of that prompt.

## 1. Outcome and repository boundaries

Build a clean, standalone Babylon.js + TypeScript browser client by adapting proven rendering code from `linegen`. The result must run in a browser, remain editable in Babylon.js Editor v5, and support AI-assisted authoring through supported official Babylon.js MCP tools. Use synthetic world data throughout Phase 1.

- Destination: <https://github.com/logingrupa/l2-browser-client>.
- Read-only source: <https://github.com/logingrupa/linegen>.
- Never modify or deploy `linegen`, or execute its server, lab or database commands. Inspect source files and licensing without starting its application or infrastructure.
- Do all implementation work in the destination. Commit and push the finished implementation only to `logingrupa/l2-browser-client`.
- Inspect source and asset licenses before copying anything into the public destination. Public visibility is not permission to redistribute. Preserve required notices and attribution. If reuse is not permitted, implement the needed behavior independently and document the decision.

Success is a working, tested, Editor-compatible foundation with an adapter boundary ready for later networking. A design document or nonfunctional scaffold alone does not satisfy the implementation task.

## 2. Technology and template compatibility

1. Start from Babylon.js Editor v5's native **Vanilla** project template, using pnpm. Check the actual template and supported version requirements before deciding entry points or directory paths.
2. Preserve `.bjseditor` project metadata, editable scene resources, asset references and the template's supported edit/save/run workflow. Do not substitute a code-only scene for the editable environment.
3. Use TypeScript with strict checking. A successful bundle is not a substitute for a strict typecheck.
4. Use **pnpm exclusively**. Pin an exact package-manager version in `package.json`, commit `pnpm-lock.yaml`, and avoid npm/yarn lockfiles and installation commands.
5. Use Vite when compatible with the native template. If the template requires another supported build path, retain it and document the reason; preserve the required pnpm command interface.
6. Use Vitest for unit tests and Playwright for browser behavior.
7. Use supported official Babylon.js MCP servers for authoring where available. Verify current tools and compatibility before configuration; do not invent server packages, commands or successful interactions.
8. Keep Editor and MCP authoring tooling separate from runtime dependencies and the world adapter contract. Browser execution must not require an MCP service.

## 3. Naming and code quality

Use self-explanatory English names for project-owned variables, functions, classes, interfaces and properties. Do not introduce abbreviations or Hungarian notation.

| Avoid | Use |
| --- | --- |
| `fnMove` | `moveCharacter` |
| `obPlayer` | `player` |
| `arEntities` | `worldEntities` |
| `calcPos` | `calculatePosition` |
| `dt` | `deltaTimeSeconds` |

Use boolean names such as `isMoving`, `hasTarget` and `isConnected`. Refactor reused identifiers consistently, including their call sites. Keep required third-party API names, framework callbacks, serialized keys and native template filenames intact; use clear internal names around those boundaries.

Avoid `any`, duplicated logic, unnecessary abstractions and oversized modules. Use narrow types or `unknown` with validation at external boundaries. Dispose subscriptions, controls, scene objects and other owned resources when their lifecycle ends.

## 4. Source reuse inventory

Inspect every file below. Reuse useful, legally redistributable implementations; record whether each was adapted, replaced or not needed and why.

| Source path in `linegen` | Behavior to inspect |
| --- | --- |
| `src/browser/positionInterpolator.ts` | Smooth movement, interpolation and snapping |
| `src/browser/entityLabels.ts` | Floating names and health bars |
| `src/browser/playerCharacters.ts` | GLB loading, skeletons and animations |
| `src/browser/characterAnimationMap.ts` | Animation selection and state mapping |
| `src/browser/arenaView.ts` | Renderer setup, camera, lighting and entity rendering |
| `src/browser/combatEffects.ts` | Cosmetic combat effects only |
| `src/browser/domHelpers.ts` | Reusable UI utilities |

Remove dependencies on SpacetimeDB, Evenfall gameplay, server simulation and source-specific application bootstrapping. Do not carry over backend code or unused systems just to preserve source file shapes. Cosmetic attack effects may support the demo but must not introduce combat calculations.

## 5. Architecture and adapter boundary

Keep modules cohesive and separate engine lifecycle, authored scene loading, camera controls, world data, entity rendering, animation, asset loading, interpolation and UI.

- Define `GameWorldAdapter` as the runtime's world-data boundary and `MockWorldAdapter` as its synthetic implementation. Select the adapter in application composition; rendering modules must not import the mock implementation directly.
- Cover initial state, spawning, state updates and despawning with typed data. Give entities stable identifiers and make position, orientation, display name, health and animation state explicit where needed.
- Route every dynamic entity lifecycle and state change through the adapter boundary. User actions that change entity state must also use that boundary. View-only targeting, camera state and visual interpolation may remain in presentation modules.
- Allow rendering to interpolate between supplied updates without writing synthetic authoritative movement inside entity renderers. Define position units, time units and teleport/snap behavior clearly; keep tests deterministic.
- Clean up adapter subscriptions and entity resources on removal and shutdown.
- Keep the contract independent of transport, Mobius packets and backend libraries. A future Interlude implementation should replace the adapter without requiring a renderer rewrite; do not build speculative networking infrastructure now.
- Keep static environment content, ground, lighting and camera configuration in Editor-editable resources. Runtime TypeScript attaches camera controls and manages dynamic players and monsters.
- Both the Editor workflow and browser development command must load the same authored environment and runtime behavior. Avoid separate hard-coded copies of the scene.

## 6. Proposed folder structure

Use this responsibility layout, adapting it to the native template where necessary. The template's actual entry points, metadata locations, scene directories and asset paths take precedence. The angle-bracket line below is descriptive, not a literal directory to create. Do not move Editor-owned resources merely to match this tree, and do not create empty modules just to fill it.

```text
l2-browser-client/
|-- .planning/
|   |-- goal.md
|   `-- phase-1-details.md
|-- <native .bjseditor metadata and editable scene resources>
|-- src/
|   |-- main.ts                    # Composition; retain native entry point if different
|   |-- engine/                    # Engine setup, render loop and disposal
|   |-- scene/                     # Load and initialize the authored environment
|   |-- camera/                    # Rotation, zoom and input handling
|   |-- world/
|   |   |-- GameWorldAdapter.ts
|   |   |-- MockWorldAdapter.ts
|   |   `-- worldTypes.ts
|   |-- entities/                  # Runtime visuals, registry and selection
|   |-- animation/                 # Animation mapping and transitions
|   |-- assets/                    # Loading code and procedural fallback creation
|   |-- interpolation/             # Movement smoothing and teleport snapping
|   `-- ui/                        # Names, health bars and diagnostic display
|-- public/
|   `-- assets/                    # Licensed runtime assets if template supports this path
|-- tests/
|   |-- unit/                      # Vitest
|   `-- browser/                   # Playwright
|-- docs/
|   |-- ARCHITECTURE.md
|   |-- SOURCE_REUSE.md
|   `-- EDITOR_MCP.md
|-- README.md
|-- package.json
|-- pnpm-lock.yaml
|-- tsconfig.json
|-- playwright.config.ts
|-- vitest.config.ts
`-- vite.config.ts                 # Only when compatible with the native template
```

`src/assets/` contains application code; asset binaries belong in the template-supported asset location. Preserve additional files the template needs. Document the final layout and any template-driven differences in `docs/ARCHITECTURE.md`.

## 7. Synthetic demo requirements

The default scene must visibly demonstrate:

- Editor-authored ground, lighting and camera settings.
- L2-style camera rotation and zoom with usable limits.
- Exactly six initial dynamic entities: one local player, two simulated remote players and three NPCs/monsters. Spawn/despawn demonstrations may change the count afterward.
- Floating display names and health bars that follow their entities.
- Smooth movement between synthetic updates, including a verifiable teleport/snap case.
- Distinct idle, run and attack animation states, including usable procedural animation if GLB assets are unavailable.
- Mouse targeting and a visible selection indicator. Despawning a selected entity must clear its selection and associated UI.
- Observable spawning and despawning, through deterministic scripted events or simple demo controls.
- A diagnostic display showing frames per second, current entity count and local player coordinates.

Use licensed GLB models when available. Otherwise use procedural placeholder characters with the required animation states. A missing or failed model load must produce a usable fallback instead of breaking the world. Do not depend on proprietary Lineage II assets or original map conversion.

## 8. Commands and meaningful verification

A fresh clone must support:

```sh
pnpm install
pnpm dev
pnpm build
pnpm test
```

Provide `pnpm typecheck` for explicit strict TypeScript verification and make `pnpm build` include that check. Make `pnpm test` run both the Vitest and Playwright suites; separate `pnpm test:unit` and `pnpm test:e2e` scripts may also be provided. Document the pnpm command for installing Playwright browser dependencies before the first browser test run. Test configuration should start and stop any needed local application server.

Use tests that exercise behavior, with deterministic synthetic data and timing where appropriate:

| Area | Required evidence |
| --- | --- |
| Strict typing and build | Typecheck and production build succeed |
| Entity lifecycle | Creation, updates and removal affect both world state and visible entities; removal cleans up labels and selection |
| Interpolation | Movement progresses correctly across updates, handles timing boundaries and snaps on teleports |
| Camera and targeting | Browser input rotates/zooms within limits and selects the expected entity |
| Animation | Idle, run and attack transitions work with available models and procedural placeholders |
| Asset failure | Missing assets produce a working fallback without uncaught exceptions |
| Browser execution | Scene runs with the expected entities and diagnostics and without uncaught runtime errors or unexpected console errors |
| Editor compatibility | If desktop Editor is available: import/open, edit an environment property, save, reopen and run the project; verify the saved edit also appears through `pnpm dev` |
| MCP authoring | If supported tools are available: perform at least one real official Babylon.js MCP interaction and record its observed result |

Run the checks and report actual results. For every Editor and MCP check, distinguish **performed/passed**, **performed/failed**, and **not performed**, with a concrete reason for an unavailable check. Installing a package or writing configuration alone is not verification. If desktop Editor or supported MCP tooling is unavailable, complete the independent implementation and automated checks, document what remains unverified and give reproduction steps. Do not claim full Editor compatibility was verified without performing the workflow.

## 9. Required documentation

- `README.md`: prerequisites and pinned versions, pnpm install/dev/build/test commands, browser test setup, demo controls, Babylon.js Editor open/edit/save/run instructions, MCP setup pointers and known limitations.
- `docs/ARCHITECTURE.md`: concise module responsibilities, final folder layout, authored-scene loading, adapter event flow, entity lifecycle, coordinate/time conventions and where a future network adapter connects.
- `docs/SOURCE_REUSE.md`: source repository and inspected revision, all seven files and their reuse decisions, destination modules, refactors, removed dependencies, source/asset licenses and required attribution. Explain independent replacements when reuse is not permitted.
- `docs/EDITOR_MCP.md`: actual Editor and tooling versions, configuration steps, verified official MCP setup, tools actually invoked, observed results, Editor compatibility checks and precise unverified or failed items. Do not commit credentials or machine-specific secrets.

At implementation handoff, summarize delivered behavior, actual checks and remaining verification gaps, and identify the destination commit/push result. Do not claim publication succeeded if it did not.

## 10. Exclusions and future step 2

Do not implement Mobius networking, Interlude packets, a WebSocket relay, SpacetimeDB, gacha, real combat calculations, quests, progression, original L2 map conversion or production deployment in Phase 1.

Future step 2 is **Real M0 networking: establish Interlude authentication, character selection and world entry against stock Mobius.** This is the biggest remaining integration challenge and is context only here. Phase 1 prepares a replaceable adapter boundary; it does not establish connections, create packet codecs, build a relay or run Mobius services.
