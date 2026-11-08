# Phase 1 - L2 Browser Client Foundation

> Original foundation brief, retained for requirements and acceptance history. The implementation was pushed in commit `3b16f1c317e20ee636a3b3f83bddafc15096740a`; see [verification](../docs/VERIFICATION.md) for actual checks and gaps. Current status and order are in [STATE.md](STATE.md) and [ROADMAP.md](ROADMAP.md); Real M0 networking is Phase 4 (stage B). The detailed Phase 1 brief and the later asset follow-up briefs are history in git.
>
> Current rules that override this brief: Babylon.js Editor is an optional viewer, off the build and runtime path (DEC-OWN-8), so the Editor template and editable-environment rules below do not apply. The current scope is [docs/PORT_SCOPE.md](../docs/PORT_SCOPE.md).

Implement and verify a standalone Babylon.js + strict TypeScript browser client in https://github.com/logingrupa/l2-browser-client. Reuse proven rendering code from an earlier sibling project after reviewing its license (superseded 2026-11-08: the repository no longer depends on that project). Deliver a working synthetic demo, not just a proposal.

The detailed requirements, folder structure and acceptance checks for this brief are history in git; this prompt summarizes them.

## Foundation

- Start with Babylon.js Editor v5's native Vanilla template. Preserve its `.bjseditor` metadata, editable scenes, required paths and supported workflow. Use Vite only where compatible.
- Use pnpm exclusively, pin its version and commit `pnpm-lock.yaml`. Do not generate npm or yarn lockfiles. Use Vitest and Playwright.
- Use clear English identifiers, meaningful boolean names, no abbreviations or Hungarian notation, no `any`, and small cohesive modules. Preserve required external API names and serialized contracts.
- Inspect the seven sibling-project files listed in the details. Adapt reusable rendering code; remove SpacetimeDB, Evenfall gameplay and server-simulation dependencies. Record provenance and attribution. Treat the sibling project as read-only: never modify or deploy it, or run its server, lab or database commands. (Superseded 2026-11-08: the repository no longer depends on that project.)

## Implementation

Separate engine, scene, camera, entities, animation, assets, interpolation and UI. Define `GameWorldAdapter` and `MockWorldAdapter`; route all dynamic entity lifecycle and state updates through the adapter boundary. Keep rendering independent of the mock implementation so a future Interlude adapter can replace it. Keep static environment resources editable in the Editor and runtime characters managed by TypeScript.

Load the same authored environment in the Editor workflow and `pnpm dev`. Include editable ground, lighting and camera; L2-style rotation/zoom; one player, two simulated remote players and three NPCs/monsters; floating names and health bars; smooth interpolation and teleport snapping; idle/run/attack animations; mouse targeting and selection; spawn/despawn; and FPS, entity count and coordinates. Use procedural animated placeholders when licensed GLB assets are unavailable.

## Verification and handoff

Run strict typechecking, build, Vitest and Playwright. Verify entity lifecycle, interpolation/teleports, camera/targeting, animation transitions, missing-asset fallback and absence of browser runtime errors. When available, actually verify Editor import, scene editing/save/reopen/run and at least one supported official Babylon.js MCP interaction. Document outcomes and unavailable checks honestly; never claim unperformed checks passed.

Provide `README.md`, `docs/ARCHITECTURE.md`, `docs/SOURCE_REUSE.md` and `docs/EDITOR_MCP.md` as specified in the details. A fresh clone must support `pnpm install`, `pnpm dev`, `pnpm build` and `pnpm test`. Commit and push the completed implementation only to `logingrupa/l2-browser-client`.

## Scope boundary

Use synthetic entities only. Exclude Mobius networking, Interlude packets, WebSocket relay, SpacetimeDB, gacha, real combat calculations, quests, progression, original L2 map conversion and production deployment.

Future step 2, context only: **Real M0 networking** - establish Interlude authentication, character selection and world entry against stock Mobius. Prepare the adapter boundary in Phase 1; implement networking later.
