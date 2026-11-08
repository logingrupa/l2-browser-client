export const worldStyles = String.raw`
.world-interface, .entity-labels {
  font-family: "Segoe UI", system-ui, sans-serif; color: #f5ecd8;
  --panel: rgb(24 28 26 / 94%); --bronze: #a58c59; --gold: #edcd88;
  --muted: #d0c6af; --line: rgb(191 167 111 / 55%); color-scheme: dark;
}
.world-interface, .entity-labels, .world-interface *, .entity-labels * { box-sizing: border-box; }
:where(.world-interface, .entity-labels) button { font: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.world-interface button:disabled { cursor: default; opacity: .45; }
.world-interface button:focus-visible, .world-interface summary:focus-visible, .entity-label:focus-visible { outline: 2px solid #ffe0a3; outline-offset: 3px; }
.world-interface * { scrollbar-color: var(--bronze) #202522; scrollbar-width: thin; }
.world-interface { position: fixed; inset: 0; pointer-events: none; z-index: 2; padding: max(12px, env(safe-area-inset-top)) 12px max(10px, env(safe-area-inset-bottom)); display: flex; flex-direction: column; }
.world-header { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
.player-panel { display: flex; align-items: center; gap: 8px; width: 180px; padding: 6px 8px 6px 4px; background: var(--panel); border: 1px solid var(--line); }
.player-emblem { width: 40px; flex: 0 0 40px; color: var(--gold); }
.player-emblem svg { width: 100%; stroke: currentColor; fill: #394440; stroke-width: 1.4; }
.player-information { flex: 1; min-width: 0; }
.player-information strong { font-weight: 600; font-size: 13px; display: flex; justify-content: space-between; }
.player-information strong > span:last-child { font-size: 10px; font-weight: 400; color: var(--muted); }
.player-information small { font-size: 10px; color: var(--muted); }
.player-health { position: relative; height: 15px; margin: 4px 0 0; background: #361c17; border: 1px solid #bc9172; }
.player-health > span { display: block; height: 100%; width: 100%; background: #a33d2e; }
.player-health b { position: absolute; inset: 0 4px; display: flex; justify-content: space-between; font-size: 10px; font-weight: 500; line-height: 12px; }
.world-location { min-width: 0; text-align: right; padding-top: 3px; max-width: 170px; text-shadow: 0 2px 4px #101715; }
.world-location h1 { font: 600 23px/.95 "Cormorant Garamond Variable", Georgia, serif; color: #fff1cf; margin: 0 0 5px; text-wrap: balance; }
.world-location > span { display: block; font-size: 10px; color: #fff0d3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.world-interface :is(.world-location, .diagnostics)[data-dev-described] { pointer-events: auto; cursor: help; -webkit-touch-callout: none; }
.target-panel { align-self: center; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; justify-content: center; margin-top: 14px; background: var(--panel); border: 1px solid var(--line); padding: 8px 12px; max-width: 100%; }
.target-panel > span { color: var(--gold); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
.target-panel strong { font-weight: 500; font-size: 13px; }
.target-panel small { color: var(--muted); font-size: 10px; }
.world-bottom { margin-top: auto; width: 100%; max-width: 500px; align-self: center; }
.world-message { margin: 0 auto 8px; padding: 6px 12px; width: fit-content; max-width: 100%; background: rgb(24 28 26 / 88%); font-size: 12px; text-align: center; color: #f3e2be;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
.world-message:empty { display: none; }
.hud-sound-cue { pointer-events: auto; display: flex; align-items: center; gap: 7px; margin: 0 auto 8px; width: fit-content; max-width: 100%;
  min-height: 36px; padding: 5px 13px 5px 10px; border: 1px solid var(--gold); background: rgb(61 53 36 / 94%); color: #ffe9b8;
  font-size: 12.5px; letter-spacing: .02em; box-shadow: 0 6px 18px rgb(0 0 0 / 35%); }
.hud-sound-cue[hidden] { display: none; }
.hud-sound-cue svg { width: 18px; height: 18px; flex: 0 0 auto; stroke: var(--gold); fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
@media (pointer: coarse) { .hud-sound-cue { min-height: 44px; } }
@media (prefers-reduced-motion: no-preference) { .hud-sound-cue svg { animation: hud-sound-pulse 1.8s ease-in-out infinite; } }
@keyframes hud-sound-pulse { 50% { opacity: .45; } }
.diagnostics { display: flex; flex-wrap: wrap; justify-content: center; gap: 0 14px; margin-bottom: 8px; font: 11px/1.5 ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; color: #fff2d7; text-shadow: 0 1px 3px #101715; }
.hud-command-row { display: flex; align-items: stretch; gap: 6px; }
.hud-command-row > .action-bar { flex: 1; min-width: 0; }
.action-bar { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 5px; padding: 6px; background: var(--panel); border: 1px solid var(--line); pointer-events: auto; }
.action-bar button { position: relative; min-width: 0; min-height: 59px; display: flex; flex-direction: column; gap: 3px; align-items: center; justify-content: center; border: 1px solid #7d735b; background: #303b35; padding: 5px; font-size: 11px; transition: background-color 120ms ease-out, border-color 120ms ease-out; }
.action-bar .attack-action { background: #654430; border-color: #b79760; }
.action-bar button:hover { background: #4b574a; border-color: var(--gold); }
.action-bar button:active { background: #79704a; }
.action-bar button[aria-pressed="true"] { border-color: var(--gold); background: #4a3e25; color: #ffe9b8; box-shadow: inset 0 -3px 0 var(--gold); }
.action-bar button[aria-pressed="true"]::after { content: ""; position: absolute; top: 5px; right: 5px; width: 6px; height: 6px; border-radius: 50%; background: var(--gold); }
.action-bar button[aria-pressed="false"] { color: #e6dcc4; }
.action-bar svg { width: 24px; height: 24px; stroke: var(--gold); fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.dev-sheet-toggle { pointer-events: auto; flex: 0 0 58px; min-width: 44px; min-height: 44px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 5px 4px; background: var(--panel); border: 1px solid var(--line); font-size: 11px; letter-spacing: .04em; transition: background-color 120ms ease-out, border-color 120ms ease-out; }
.dev-sheet-toggle svg { width: 22px; height: 22px; stroke: var(--gold); fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.dev-sheet-toggle:hover { background: #2f3934; border-color: var(--gold); }
.dev-sheet-toggle:active { background: #79704a; }
.dev-sheet-toggle[aria-expanded="true"] { background: #3d3524; border-color: var(--gold); color: #ffe9b8; box-shadow: inset 0 -2px 0 var(--gold); }
.world-interface[data-dev-lift] { padding-bottom: calc(var(--dev-sheet-lift, 0px) + 8px); }
.world-interface[data-dev-docked][data-dev-sheet-mode="bottom"] { padding-bottom: 10px; }
.world-interface[data-dev-sheet-mode="bottom"][data-dev-sheet-open] .diagnostics { display: none; }
.world-interface[data-dev-sheet-mode="bottom"][data-dev-sheet-open] .world-message { display: block; margin-bottom: 6px; padding: 4px 10px; white-space: nowrap; text-overflow: ellipsis; }
.world-interface[data-dev-sheet-mode="bottom"][data-dev-sheet-open] .world-message:empty,
.world-interface[data-dev-sheet-mode="bottom"][data-dev-sheet-open][data-dev-snap="full"] .world-message { display: none; }
.world-interface[data-dev-sheet-mode="bottom"][data-dev-sheet-open] .hud-sound-cue { margin-bottom: 6px; }
.world-interface[data-dev-sheet-mode="bottom"][data-dev-sheet-open] .action-bar { gap: 4px; padding: 4px; }
.world-interface[data-dev-sheet-mode="bottom"][data-dev-sheet-open] .action-bar button { min-height: 44px; gap: 1px; padding: 3px 2px; font-size: 10.5px; line-height: 1.2; }
.world-interface[data-dev-sheet-mode="bottom"][data-dev-sheet-open] :is(.action-bar, .dev-sheet-toggle) svg { width: 18px; height: 18px; }
.world-interface[data-dev-sheet-mode="bottom"][data-dev-sheet-open] .dev-sheet-toggle { min-height: 44px; gap: 1px; padding: 3px 2px; flex-basis: 52px; font-size: 10.5px; }
.world-interface[data-dev-sheet-mode="side"]:is([data-dev-sheet="overlay"], [data-dev-sheet="pinned"]) { padding-right: calc(var(--dev-sheet-width, 380px) + 12px); }
.entity-labels { position: fixed; inset: 0; z-index: 1; pointer-events: none; overflow: hidden; }
.entity-label { position: absolute; transform: translate(-50%, -100%); min-height: 44px; min-width: 70px; border: 0; background: transparent; padding: 10px 7px 4px; pointer-events: auto; font: 11px/1.2 "Segoe UI", sans-serif; color: #fff4d8; text-shadow: 0 1px 2px #101715, 1px 0 3px #101715; white-space: nowrap; }
.entity-label > span:first-child { background: rgb(24 28 26 / 80%); padding: 1px 4px; }
.entity-label[hidden] { display: none; }
.entity-label[aria-pressed="true"] { color: #ffe3a5; }
.entity-label[aria-pressed="true"] > span:first-child { text-decoration: underline; text-underline-offset: 3px; }
.entity-health { height: 4px; display: block; max-width: 72px; margin: 4px auto 0; border: 1px solid rgb(18 25 22 / 90%); background: #492f27; }
.entity-health-fill { height: 100%; display: block; transform-origin: left; background: #87bea4; }
.entity-label[data-kind="monster"] .entity-health-fill { background: #d59472; }
.entity-diagnostic { display: block; margin-top: 3px; background: rgb(24 28 26 / 80%); padding: 1px 4px; }
.entity-diagnostic[hidden] { display: none; }
@media (min-width: 760px) {
  .world-interface { padding: 22px 26px; }
  .player-panel { width: 225px; padding: 8px; gap: 10px; }
  .player-emblem { width: 45px; flex-basis: 45px; }
  .player-information strong { font-size: 15px; }
  .world-location { max-width: none; }
  .world-location h1 { font-size: 34px; }
  .world-location > span { font-size: 12px; }
  .target-panel { margin-top: -24px; }
  .entity-label { font-size: 12px; }
  .world-bottom { max-width: 420px; }
}
@media (max-width: 420px) { .world-location h1 { font-size: 20px; } }
@media (max-width: 359.98px) {
  .hud-command-row { gap: 5px; }
  .dev-sheet-toggle { flex-basis: 48px; }
  .action-bar { gap: 3px; padding: 4px; }
  .world-interface[data-dev-sheet-mode="bottom"][data-dev-sheet-open] .dev-sheet-toggle { flex-basis: 48px; }
}
@media (max-height: 500px) and (orientation: landscape) {
  .world-interface { padding: 8px 12px; }
  .target-panel { margin-top: -32px; }
  .world-bottom { max-width: 360px; align-self: flex-end; }
  .world-message { display: none; }
  .action-bar button { min-height: 44px; flex-direction: row; }
  .action-bar svg { width: 18px; height: 18px; }
  .diagnostics { margin-bottom: 3px; }
  .dev-sheet-toggle { flex-direction: row; gap: 6px; flex-basis: 70px; }
  .dev-sheet-toggle svg { width: 18px; height: 18px; }
}
@media (prefers-reduced-motion: reduce) { .world-interface button, .entity-labels button { transition: none !important; animation: none !important; } .hud-sound-cue svg { animation: none !important; } }
`;
