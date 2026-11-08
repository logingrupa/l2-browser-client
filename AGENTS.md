# Agent instructions

Browser client for Lineage II Interlude on Babylon.js WebGPU. These rules are specific to this repo.

## Project rules

### Decisions and planning
- Current decisions live in [.planning/PROJECT.md](.planning/PROJECT.md) (DEC-OWN-1 to DEC-OWN-8) and [docs/PORT_SCOPE.md](docs/PORT_SCOPE.md). They win over every other doc.
- Requirements, phases and state: [.planning/REQUIREMENTS.md](.planning/REQUIREMENTS.md), [.planning/ROADMAP.md](.planning/ROADMAP.md), [.planning/STATE.md](.planning/STATE.md).
- Plan and execute through GSD: `/gsd-quick` for small tasks, `/gsd-plan-phase` and `/gsd-execute-phase` for phase work.

### Source fidelity
- Never invent Lineage II values (sizes, timings, colors, offsets, sounds, stats, names).
- Every value comes from the reference client, IMPORTA-PC `C:/Lineage2-client`, through a pinned recipe or script, and records its source.
- `E:/Lineage2-client` is a conversion source only after the full-tree hash lock (FOUND-03).
- An unresolved value stays visibly unresolved. No procedural stand-ins on the native route.

### Server boundary
- The client only displays what a server sends. Gameplay state enters through `GameWorldAdapter` and nowhere else.
- The client never computes damage, stats, quest or progression outcomes.

### Lanes
- At most 3 lanes on DATABASE-PC, plus the integration thread in the main checkout. One part per branch, named `<part>/<slug>`.
- Lanes never run scripts that write the main native store: `assets:*`, `world:stage`, `assets:stage`, `stage_*`, `derive-*`, `migrate-*`, or preview scripts. Only the integration thread runs them, in the main checkout.
- Lanes start from committed code only. Merge one branch at a time; a contract change merges first.

### Build
- The Babylon.js Editor is not in the build path (DEC-OWN-8, NOED-01 to NOED-05). Do not add Editor steps to `pnpm dev` or `pnpm build`.
- `stage-webgpu-compilers` stays in dev and build, because the runtime loads those compilers.

### Test process cleanup
- After every plan, verification and phase, stop what your runs started: dev servers, Vite preview, Playwright and other headless browsers, e2e runners and Vitest workers.
- Stop them by the PID your command started, or by a command line that holds your own worktree path or dev port. Never by image name (`node.exe`, `chrome.exe`, `msedge.exe`, `chrome-headless-shell.exe`): other lanes and the owner run the same executables.
- Before a done claim, check that nothing you started still runs: no listener on your dev port, and no browser or node process with your worktree path in its command line.

### Machine schedule
- DATABASE-PC relays the church livestream Sun 10:00-14:00 and Thu 19:00-21:30 Riga time. In those windows run no builds, dev servers, tests, installs, hashing or conversions.
- Run heavy commands at BelowNormal priority.

### Screenshots and viewports
- The default phone is the iPhone 15 Pro Max held sideways: 932 x 430 CSS px, landscape, with touch. Phone screenshots use it. In this repo this replaces the global 390 px portrait default.
- Desktop screenshots stay 1440 x 900.
- Portrait 430 x 932 is still checked for horizontal scroll, but it is not the evidence screenshot.
- Headless e2e runs WebGPU on SwiftShader, a CPU adapter (`playwright.config.ts`), so its FPS readout is not a measurement. FPS and performance claims come only from runs with `WORLD_HARDWARE_TEST=1` on the GTX 1060, outside the relay windows.

### Docs
- One evidence doc per part, `docs/parts/<part>/EVIDENCE.md`, under about 30 KB. It states what passes now, what is open, and where the evidence is.
- Status goes in `STATUS.md` (one line per part, rewritten in place). Decisions go in `DECISIONS.md` (append-only, one dated line each).
- No new continuation or handoff prompts. Resume from GSD state.

### Git
- Commit on your own branch. Never push or merge without the owner.

## Code rules

- No dead code. Delete unused functions, exports, files, flags and assets in the same change that makes them unused. No commented-out code.
- DRY and single responsibility. One owner per piece of logic. Reuse before adding.
- No speculative abstractions, options, or compatibility shims for paths that no longer exist.
- No comments in code. Ever. The code explains itself.
- Every function, variable, type and file name says what it does or holds, in full words (`decodeSkillgrpRecords`, not `decode` or `parse2`). If a name cannot explain it, split or rename until it can.
- The only exception is machine directives a tool needs to work: `@ts-expect-error` with no prose, `eslint-disable-next-line` for a named rule, a shebang. They are not explanations.
- Comment cleanup happens per file as work goes. When you touch a file, remove every comment in the whole file, not only in the lines you changed, and rename whatever those comments were explaining. There is no separate repo-wide comment sweep.
- Fix the root cause, not the symptom. No retries, sleeps or tolerances that hide a bug.
- Validate at trust boundaries (decoded files, server messages) with guard clauses and clear errors. Inside the code, trust the types.
- Small files with explicit names. Split a file that grows past about 400 lines or mixes concerns.
- TypeScript strict, no `any`, pnpm only.
- Every behavior change ships with a Vitest test. UI changes also get a Playwright check.
- A "done" claim needs a passing test or a screenshot.
- No TODO without a requirement ID from [.planning/REQUIREMENTS.md](.planning/REQUIREMENTS.md).
- Human-readable text (docs, commit messages, UI copy) uses plain hyphens, no em or en dashes, and sentence-case headings.
