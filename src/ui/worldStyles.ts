/** Shared browser/Editor HUD styles. Kept in TypeScript for the Editor script compiler. */
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
.world-location { text-align: right; padding-top: 3px; max-width: 155px; text-shadow: 0 2px 4px #101715; }
.world-location h1 { font: 600 23px/.95 "Cormorant Garamond Variable", Georgia, serif; color: #fff1cf; margin: 0 0 5px; text-wrap: balance; }
.world-location > span { font-size: 10px; color: #fff0d3; }
.target-panel { align-self: center; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; justify-content: center; margin-top: 14px; background: var(--panel); border: 1px solid var(--line); padding: 8px 12px; max-width: 100%; }
.target-panel > span { color: var(--gold); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
.target-panel strong { font-weight: 500; font-size: 13px; }
.target-panel small { color: var(--muted); font-size: 10px; }
.world-bottom { margin-top: auto; width: 100%; max-width: 500px; align-self: center; }
.world-message { margin: 0 auto 8px; padding: 6px 12px; width: fit-content; max-width: 100%; background: rgb(24 28 26 / 88%); font-size: 12px; text-align: center; color: #f3e2be; }
.diagnostics { display: flex; justify-content: center; gap: 14px; margin-bottom: 8px; font: 11px/1.5 ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; color: #fff2d7; text-shadow: 0 1px 3px #101715; }
.action-bar { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; padding: 6px; background: var(--panel); border: 1px solid var(--line); pointer-events: auto; }
.action-bar button { min-width: 0; min-height: 59px; display: flex; flex-direction: column; gap: 3px; align-items: center; justify-content: center; border: 1px solid #7d735b; background: #303b35; padding: 5px; font-size: 11px; transition: background-color 120ms ease-out, border-color 120ms ease-out; }
.action-bar .attack-action { background: #654430; border-color: #b79760; }
.action-bar button:hover { background: #4b574a; border-color: var(--gold); }
.action-bar button:active { background: #79704a; }
.action-bar svg { width: 24px; height: 24px; stroke: var(--gold); fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.demo-controls { pointer-events: auto; background: var(--panel); border: 1px solid var(--line); border-top: 0; }
.demo-controls summary { min-height: 44px; padding: 13px 14px; cursor: pointer; font-size: 12px; color: var(--gold); }
.demo-controls[open] summary { border-bottom: 1px solid var(--line); }
.demo-controls-body { max-height: 27dvh; overflow-y: auto; padding: 10px 12px; }
.secondary-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.secondary-actions button { flex: 1; min-height: 44px; border: 1px solid var(--line); background: #303b35; font-size: 12px; padding: 8px; white-space: nowrap; }
.secondary-actions button:hover:enabled { background: #4b574a; }
.demo-controls-body p { font-size: 11px; line-height: 1.5; color: var(--muted); margin: 10px 0 0; }
.entity-labels { position: fixed; inset: 0; z-index: 1; pointer-events: none; overflow: hidden; }
.entity-label { position: absolute; transform: translate(-50%, -100%); min-height: 44px; min-width: 70px; border: 0; background: transparent; padding: 10px 7px 4px; pointer-events: auto; font: 11px/1.2 "Segoe UI", sans-serif; color: #fff4d8; text-shadow: 0 1px 2px #101715, 1px 0 3px #101715; white-space: nowrap; }
.entity-label > span:first-child { background: rgb(24 28 26 / 80%); padding: 1px 4px; }
.entity-label[hidden] { display: none; }
.entity-label[aria-pressed="true"] { color: #ffe3a5; }
.entity-label[aria-pressed="true"] > span:first-child { text-decoration: underline; text-underline-offset: 3px; }
.entity-health { height: 4px; display: block; max-width: 72px; margin: 4px auto 0; border: 1px solid rgb(18 25 22 / 90%); background: #492f27; }
.entity-health-fill { height: 100%; display: block; transform-origin: left; background: #87bea4; }
.entity-label[data-kind="monster"] .entity-health-fill { background: #d59472; }
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
  .demo-controls-body { max-height: 220px; }
}
@media (max-height: 500px) and (orientation: landscape) {
  .world-interface { padding: 8px 12px; }
  .target-panel { margin-top: -32px; }
  .world-bottom { max-width: 360px; align-self: flex-end; }
  .world-message { display: none; }
  .action-bar button { min-height: 44px; flex-direction: row; }
  .action-bar svg { width: 18px; height: 18px; }
  .diagnostics { margin-bottom: 3px; }
  .demo-controls summary { padding-block: 13px; }
}
@media (prefers-reduced-motion: reduce) { .world-interface button, .entity-labels button { transition: none !important; } }
`;
