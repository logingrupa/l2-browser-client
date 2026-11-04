# Phase 1 verification

Verification date: **2026-11-04**. Environment: Windows, Node.js **24.15.0**, pnpm **10.32.1**, and Playwright Chromium using software WebGL rendering. Dependencies and tools are pinned in `package.json` and `pnpm-lock.yaml`.

These results cover the procedural foundation in commit `3b16f1c317e20ee636a3b3f83bddafc15096740a`. The subsequent Markdown update did not change runtime code or rerun these application checks. Local converted GLBs were located and structurally inspected, but their rendering, skinning, animation and integration in this destination remain unverified. Prior evidence from the conversion workspace is not a result for this client. See [ROADMAP.md](ROADMAP.md) for current scope and Phase 2.

## Commands and observed results

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; the committed dependency graph installed without lockfile changes. |
| `pnpm typecheck` | Passed with strict checking, unchecked-index checking, and exact optional-property types. |
| `pnpm build` | Passed: native Editor scene export, strict typecheck, and Vite production bundle. Vite reports the large-chunk warning described below. |
| `pnpm test:unit` | Passed: **37 tests** covering adapter events, movement, interpolation, animation, asset fallback/cleanup, native scene packing, and the Editor compiler contract. |
| `pnpm test` | Passed in the final sequential run: **37/37 Vitest tests** across seven files and **9/9 Playwright tests**, including ground movement and mobile orbit/pinch. |
| Desktop/mobile visual captures | Passed review at **1440 × 900** and **390 × 844**; each capture recorded zero uncaught exceptions and zero console errors. Images are in [screenshots/](screenshots/). |

Install Chromium before the first browser run with `pnpm test:setup`. Linux hosts that need system dependencies can use `pnpm exec playwright install --with-deps chromium`. `pnpm test` runs Vitest followed by Playwright; Playwright starts and stops its own `pnpm dev` server on port 5173.

## Behavioral evidence

The browser suite exercises the running scene through UI and pointer input, with read-only diagnostics used for assertions:

- Loads authored geometry, camera and lighting, six visible characters, floating labels, health bars, and live diagnostics.
- Selects a character with a mouse pick, despawns it, and verifies label, selection, and mesh removal; spawns and selects a replacement through the controls.
- Observes interpolated remote movement and immediate local teleport snapping.
- Clicks a projected courtyard destination, observes authoritative and interpolated movement, and verifies arrival and the return to idle.
- Switches idle/run/attack states and observes changing procedural joint poses.
- Uses right drag and the wheel to rotate and zoom, checking camera limits.
- Exercises both malformed successful asset responses and HTTP 404 responses; a selectable animated placeholder remains usable.
- Checks mobile controls, horizontal overflow, touch controls, touch orbit, and a two-finger pinch gesture.

Every browser test rejects uncaught exceptions and unexpected console errors. The HTTP 404 test permits only the expected resource error for its deliberately missing model URL; this is not a claim that a failed request produces no console message. No licensed external character GLB is bundled. Unit tests use synthetic model fixtures to verify clip mapping, state preservation, blending, and resource disposal.

The pinch check exposed two issues. The camera had two-finger panning enabled with zero panning speed, which discarded small pinch increments; it now explicitly disables two-finger panning. Playwright's default touch emulation advertised only one touch point, so Babylon ignored the second finger; the mobile test now advertises five touch points before loading the scene. The gesture regression passed both its targeted rerun and the final complete suite.

## Editor and official MCP evidence

The native Editor Vanilla template, project metadata, resource paths, packing CLI, scene script attachment, and supported source workflows were inspected at the pinned upstream revision. Two unit tests call the real official `pack()` API in temporary fixtures, verify authored geometry/settings, and confirm a changed sunlight intensity survives repacking. Another test emulates the Editor's CommonJS compiler settings and verifies that the scene script produces no unsupported CSS/font outputs.

These checks **do not verify desktop execution**. The following remain **not performed**:

- Desktop Editor import/open, environment editing, save/reopen, and scene/project play: no installed Babylon.js Editor was available in the checked application directories, registry entries, or running processes.
- A saved desktop edit appearing in `pnpm dev`: no desktop edit/save round trip was possible.
- An official Babylon.js MCP authoring interaction: no connected Babylon MCP tools or active desktop scene were available. No official MCP tool was invoked.

A direct localhost availability probe failed; it was not an MCP interaction. [EDITOR_MCP.md](EDITOR_MCP.md) records the inspected official setup, precise statuses, and reproduction steps for the outstanding checks.

## Practical limits

Mobile verification uses Chromium touch emulation, not a physical phone. Safari, Firefox, physical touch hardware, desktop Editor rendering, and arbitrary third-party character rigs were not tested. The screenshots' FPS values reflect software rendering on this machine and are not a device performance benchmark.

The production build includes an approximately **3.57 MB** JavaScript runtime chunk (**0.88 MB gzip**), which triggers Vite's size warning. The authored scene also contains serialized geometry. Download-size optimization and physical-device performance testing remain future work. No production deployment or server/network integration was performed.
