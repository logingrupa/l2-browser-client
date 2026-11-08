# Agent instructions

Browser client for Lineage II Interlude on Babylon.js WebGPU. These rules are specific to this repo.

## Project rules

### Decisions and planning
- Current decisions live in [.planning/PROJECT.md](.planning/PROJECT.md) (DEC-OWN-1 to DEC-OWN-12). They win over every other doc. [docs/PORT_SCOPE.md](docs/PORT_SCOPE.md) holds the scope tables those decisions cite.
- Requirements, phases and state: [.planning/REQUIREMENTS.md](.planning/REQUIREMENTS.md), [.planning/ROADMAP.md](.planning/ROADMAP.md), [.planning/STATE.md](.planning/STATE.md).
- The docs in `docs/` are short summaries of current facts, not decisions. When a doc and `.planning` disagree, `.planning` wins and you fix the doc in the same change. Older detail lives in git history.

### GSD workflow
Use the smallest command that fits the work.
- `/gsd-fast`: 3 files or fewer and a known cause. Runs inline, with no plan and no subagents. Start here for small fixes.
- `/gsd-quick`: multi-file work or an unknown cause. Add `--full` when the change touches `package.json`, `pnpm-lock.yaml`, build or test config, or `recipes/`.
- `/gsd-debug`: a bug with an unknown cause. It keeps its state across context resets.
- Phase work: `/gsd-autonomous` runs discuss, plan, execute and verify without stopping. To go one step at a time, use `/gsd-discuss-phase`, `/gsd-plan-phase`, `/gsd-execute-phase` and `/gsd-verify-work`.
- Review: `/gsd-code-review` (`--fix` applies the findings), plus one Codex cross-model review through T3 `delegate_task` for risky changes. No replicated reviewer votes.
- Status and resume: `/gsd-progress` or `/gsd-next` show where things stand. `/gsd-resume-work` picks up interrupted work.
- Skip discuss and research when the plan is already clear.

### Source fidelity
- Never invent Lineage II values (sizes, timings, colors, offsets, sounds, stats, names).
- Every value comes from the reference client, IMPORTA-PC `C:/Lineage2-client`, through a pinned recipe or script, and records its source.
- `E:/Lineage2-client` is a conversion source only after the full-tree hash lock (FOUND-03).
- Other workspaces under `C:\laragon\www` are unrelated projects. Do not read or reuse them for this client. Two exceptions: the pinned Elbera source that [.planning/PROJECT.md](.planning/PROJECT.md) names, and the in-repo clones in the ignored `.assets/reference/` (Lineage2JS `854f629`, l2js-core `4aac1bd`; DEC-OWN-12). The clones are read-only clean-room references: read them to understand mechanisms, never copy their code, and never install, build or run them.
- A constant learned from those references is an unconfirmed default until it is re-derived against the Interlude binaries (POL-04).
- An unresolved value stays visibly unresolved. No procedural stand-ins on the native route.

### Interface
- The only game interface is the original Interlude interface (DEC-OWN-10). Window layout comes from `interface.xdat`. Skin, fonts and icons come from the client's converted UI textures.
- No custom HUD styling, design tokens or design-skill output (`impeccable`, `frontend-design`) for game UI. The procedural HUD is a stand-in until native windows replace it. Do not polish it.
- The developer sheet is a developer tool, not game UI.

### Server boundary
- The client only displays what a server sends. Gameplay state enters through `GameWorldAdapter` and nowhere else.
- The client never computes damage, stats, quest or progression outcomes.

### Lanes
- Parallel work uses the `lane` skill. Load it when two or more agents work on this repo at once, or when your checkout is an `l2b-*` lane. A lane is a separate checkout in `C:\laragon\www\l2b-<slug>` with its own `node_modules` and dev server port. The skill creates, watches and removes lanes.
- At most 3 lanes on DATABASE-PC, plus the integration thread in the main checkout. One part per branch, named `<part>/<slug>`.
- Lanes never run scripts that write the main native store: `assets:*`, `assets:stage`, `stage_*`, `derive-*`, `migrate-*`, or preview scripts. Only the integration thread runs them, in the main checkout.
- Lanes start from committed code only. Merge one branch at a time; a contract change merges first.

### Build
- The Babylon.js Editor is not in the build path (DEC-OWN-8, NOED-01 to NOED-05). Do not add Editor steps to `pnpm dev` or `pnpm build`.
- `stage-webgpu-compilers` stays in dev and build, because the runtime loads those compilers.

### Test process cleanup
- After every plan, verification and phase, stop what your runs started: dev servers, Vite preview, Playwright and other headless browsers, e2e runners and Vitest workers.
- Stop them by the PID your command started, or by a command line that holds your own worktree path or dev port. Never by image name (`node.exe`, `chrome.exe`, `msedge.exe`, `chrome-headless-shell.exe`): other lanes and the owner run the same executables.
- Before a done claim, check that nothing you started still runs: no listener on your dev port, and no browser or node process with your worktree path in its command line.

### Machine schedule
- DATABASE-PC is free all the time: builds, dev servers, tests, installs, hashing and conversions may run whenever the work needs them.
- PROMINENCE-PC runs its nightly backup 23:15-03:45 Riga time. Start no heavy run there in that window.
- Run heavy commands at BelowNormal priority.

### Screenshots and viewports
- The default phone is the iPhone 15 Pro Max held sideways (DEC-OWN-9): 932 x 430 CSS px, landscape, with touch. Phone screenshots use it. In this repo this replaces the global 390 px portrait default.
- Desktop screenshots stay 1440 x 900.
- Portrait 430 x 932 is still checked for horizontal scroll, but it is not the evidence screenshot.
- Headless e2e runs WebGPU on SwiftShader, a CPU adapter (`playwright.config.ts`), so its FPS readout is not a measurement. FPS and performance claims come only from runs with `WORLD_HARDWARE_TEST=1` on the GTX 1060.

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
