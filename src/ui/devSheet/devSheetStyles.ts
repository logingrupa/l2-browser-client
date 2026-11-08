export const devSheetStyles = String.raw`
.dev-sheet, .dev-hovercard {
  --dev-surface: rgb(19 23 21 / 97%); --dev-raised: #242c28; --dev-inset: #141917; --dev-hairline: rgb(191 167 111 / 20%);
  --dev-text: #f5ecd8; --dev-bright: #fff1cf; --dev-native: #8fc7ad; --dev-presentation: #edcd88; --dev-unverified: #e3a17f;
  --dev-mono: ui-monospace, "Cascadia Mono", Consolas, monospace; --dev-control: 32px; --dev-chip: 28px; --dev-label-column: 8.5em;
  font-family: "Segoe UI", system-ui, sans-serif; color: var(--dev-text); color-scheme: dark;
}
.dev-sheet *, .dev-hovercard * { box-sizing: border-box; }
.dev-sheet { position: absolute; z-index: 5; display: flex; flex-direction: column; overflow: hidden; pointer-events: auto;
  background: var(--dev-surface); font-size: 12px; line-height: 1.4; box-shadow: 0 0 0 1px rgb(0 0 0 / 45%), 0 18px 40px rgb(0 0 0 / 40%); }
.dev-sheet[data-mode="side"] { top: 0; right: 0; bottom: 0; width: var(--dev-sheet-width, 380px); max-width: 100%;
  border-left: 1px solid var(--line); padding-right: env(safe-area-inset-right);
  transition: transform 190ms cubic-bezier(.2, .8, .2, 1), opacity 150ms ease-out; }
.world-interface[data-dev-docked] > .dev-sheet[data-mode="side"] { right: auto; left: 100%; box-shadow: none; }
.dev-sheet[data-mode="side"][data-state="closed"] { transform: translateX(18px); opacity: 0; visibility: hidden;
  transition: transform 140ms ease-in, opacity 120ms ease-in, visibility 0s linear 140ms; }
.dev-sheet[data-mode="bottom"] { left: 0; right: 0; bottom: 0; height: var(--dev-sheet-height, 50%); max-height: 100dvh;
  background: rgb(19 23 21); border-top: 1px solid var(--line); padding-bottom: env(safe-area-inset-bottom);
  transition: transform 220ms cubic-bezier(.2, .8, .2, 1), height 200ms cubic-bezier(.2, .8, .2, 1); }
.world-interface[data-dev-docked] > .dev-sheet[data-mode="bottom"] { bottom: calc(-1 * var(--dev-sheet-dock, 0px)); box-shadow: 0 -1px 0 rgb(0 0 0 / 45%); }
.dev-sheet[data-mode="bottom"][data-state="closed"] { transform: translateY(calc(100% + 16px)); visibility: hidden;
  transition: transform 170ms ease-in, visibility 0s linear 170ms; }
.dev-sheet[data-dragging] { transition: none; user-select: none; }
:where(.dev-sheet) button { font: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.dev-sheet button:disabled, .dev-sheet [aria-disabled="true"] { cursor: not-allowed; opacity: .45; }
.dev-sheet :focus-visible { outline: 2px solid #ffe0a3; outline-offset: 2px; }
.dev-sheet svg { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; flex: 0 0 auto; }

.dev-sheet-grip { display: none; }
.dev-sheet[data-mode="bottom"] .dev-sheet-grip { display: flex; align-items: center; justify-content: center; width: 100%; height: 14px;
  flex: 0 0 14px; padding: 0; border: 0; background: transparent; touch-action: none; cursor: grab; }
.dev-sheet-grip::before { content: ""; width: 40px; height: 4px; border-radius: 2px; background: var(--bronze); opacity: .8; }
.dev-sheet[data-dragging] .dev-sheet-grip { cursor: grabbing; }
.dev-sheet-header { display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 14px; flex: 0 0 auto;
  border-bottom: 1px solid var(--dev-hairline); background: linear-gradient(rgb(237 205 136 / 7%), rgb(237 205 136 / 0%)); }
.dev-sheet[data-pinned="false"] .dev-sheet-header { border-bottom-style: dashed; }
.dev-sheet-heading { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; color: var(--gold); }
.dev-sheet-heading > svg { width: 22px; height: 22px; }
.dev-sheet-titles { min-width: 0; display: grid; gap: 1px; }
.dev-sheet-titles h2 { margin: 0; font: 600 20px/1 "Cormorant Garamond Variable", Georgia, serif; color: var(--dev-bright); letter-spacing: .01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dev-sheet-status { font-size: 10.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dev-sheet-header[data-flash] .dev-sheet-status { color: var(--gold); }
.dev-pin, .dev-close { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: var(--dev-control); flex: 0 0 auto;
  border: 1px solid var(--line); background: var(--dev-raised); font-size: 12px; transition: background-color 120ms ease-out, border-color 120ms ease-out; }
.dev-pin { padding: 0 7px 0 9px; color: var(--muted); }
.dev-close { width: var(--dev-control); padding: 0; }
.dev-pin svg, .dev-close svg { width: 16px; height: 16px; }
.dev-pin:hover, .dev-close:hover { background: #333d37; border-color: var(--gold); }
.dev-pin-state { min-width: 3.1em; padding: 2px 5px; border: 1px dashed currentColor; font: 700 10px/1.2 var(--dev-mono); letter-spacing: .08em;
  text-align: center; text-transform: uppercase; }
.dev-pin[aria-pressed="true"] { background: #4a3e25; border-color: var(--gold); color: #ffe9b8; box-shadow: inset 0 -2px 0 var(--gold); }
.dev-pin[aria-pressed="true"] .dev-pin-state { border: 1px solid var(--gold); background: var(--gold); color: #1d1a12; }

.dev-sheet-toolbar { display: grid; gap: 8px; padding: 8px 12px 9px; flex: 0 0 auto; border-bottom: 1px solid var(--dev-hairline); }
.dev-tabs { display: flex; flex-wrap: nowrap; gap: 4px; min-width: 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain;
  scrollbar-width: none; scroll-padding-inline: 24px; -webkit-overflow-scrolling: touch; }
.dev-tabs::-webkit-scrollbar { display: none; }
.dev-tabs[data-overflow="end"] { -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent); mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent); }
.dev-tabs[data-overflow="start"] { -webkit-mask-image: linear-gradient(90deg, transparent, #000 28px); mask-image: linear-gradient(90deg, transparent, #000 28px); }
.dev-tabs[data-overflow="both"] { -webkit-mask-image: linear-gradient(90deg, transparent, #000 28px, #000 calc(100% - 28px), transparent);
  mask-image: linear-gradient(90deg, transparent, #000 28px, #000 calc(100% - 28px), transparent); }
.dev-tab { position: relative; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 10px;
  border: 1px solid var(--dev-hairline); background: transparent; color: var(--muted); font-size: 12px; white-space: nowrap;
  transition: color 120ms ease-out, border-color 120ms ease-out, background-color 120ms ease-out; }
.dev-tab svg { width: 15px; height: 15px; }
.dev-tab:hover { color: var(--dev-bright); border-color: var(--line); }
.dev-tab[aria-selected="true"] { color: var(--dev-bright); border-color: var(--gold); background: rgb(237 205 136 / 12%); box-shadow: inset 0 -2px 0 var(--gold); }
.dev-tab-count { position: absolute; top: 2px; right: 2px; min-width: 15px; padding: 1px 3px; background: var(--gold); color: #1d1a12;
  font: 700 9.5px/1.1 var(--dev-mono); text-align: center; }
.dev-tab-count:empty { display: none; }
.dev-sheet[data-filtering] .dev-tab { padding-right: 22px; }
.dev-sheet[data-filtering] .dev-tab[data-matches="0"] { display: none; }
.dev-filter { display: flex; align-items: stretch; min-width: 0; min-height: var(--dev-control); background: var(--dev-inset);
  border: 1px solid var(--dev-hairline); color: var(--muted); }
.dev-filter:focus-within { border-color: var(--gold); color: var(--gold); }
.dev-filter-field { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0 10px; cursor: text; }
.dev-filter svg { width: 15px; height: 15px; }
.dev-filter input { flex: 1; min-width: 0; min-height: calc(var(--dev-control) - 2px); padding: 0; border: 0; outline: none;
  background: transparent; color: var(--dev-text); font: inherit; font-size: 12px; }
.dev-sheet .dev-filter input:focus-visible { outline: none; }
.dev-filter input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; display: none; }
.dev-filter input::placeholder { color: rgb(208 198 175 / 62%); }
.dev-filter-clear { flex: 0 0 var(--dev-control); display: inline-grid; place-items: center; padding: 0; border: 0;
  border-left: 1px solid var(--dev-hairline); background: transparent; color: var(--muted); }
.dev-filter-clear[hidden] { display: none; }
.dev-filter-clear svg { width: 14px; height: 14px; }
.dev-filter-clear:hover { color: var(--dev-bright); }

.dev-sheet-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 2px 12px 18px;
  container-type: inline-size; scrollbar-gutter: stable; scrollbar-color: var(--bronze) transparent; scrollbar-width: thin; }
.dev-panel[hidden] { display: none; }
.dev-panel-title { display: none; margin: 12px 0 0; font: 600 17px/1.1 "Cormorant Garamond Variable", Georgia, serif; color: var(--gold); }
.dev-sheet[data-filtering] .dev-panel-title { display: block; }
.dev-sheet-empty { margin: 18px 0 0; color: var(--muted); font-size: 12px; text-align: center; }
.dev-sheet-empty[hidden] { display: none; }
.dev-group { border-bottom: 1px solid var(--dev-hairline); }
.dev-group-heading { display: flex; align-items: center; gap: 6px; margin: 0; font: inherit; }
.dev-group-toggle { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; min-height: 36px; padding: 6px 0; border: 0;
  background: transparent; color: var(--gold); text-align: left; font-size: 10.5px; font-weight: 600; letter-spacing: .11em; text-transform: uppercase; }
.dev-group-toggle svg { width: 13px; height: 13px; transform: rotate(90deg); transition: transform 140ms ease-out; color: var(--bronze); }
.dev-group[data-collapsed] .dev-group-toggle svg { transform: none; }
.dev-group-toggle:hover .dev-group-title { color: var(--dev-bright); }
.dev-group-count { margin-left: auto; font: 500 10px/1 var(--dev-mono); letter-spacing: 0; color: var(--muted); }
.dev-group-count:empty { display: none; }
.dev-group-body { display: grid; gap: 8px; padding: 2px 0 12px; min-width: 0; }
.dev-group[data-collapsed] > .dev-group-body { display: none; }
.dev-sheet[data-filtering] .dev-group[data-collapsed] > .dev-group-body { display: grid; }
.dev-sheet [data-dev-filtered="out"] { display: none !important; }

.dev-row { display: grid; grid-template-columns: var(--dev-label-column) minmax(0, 1fr); align-items: center; gap: 4px 8px; min-height: var(--dev-control); }
.dev-row[data-info] { grid-template-columns: var(--dev-label-column) minmax(0, 1fr) auto; }
.dev-row[data-layout="stacked"] { grid-template-columns: minmax(0, 1fr) auto; }
.dev-row[data-layout="stacked"] > .dev-row-control { grid-column: 1 / -1; grid-row: 2; }
.dev-row.dev-level-row { grid-template-columns: var(--dev-label-column) minmax(0, 1fr); }
.dev-level-row > .dev-row-control { display: grid; grid-template-columns: minmax(0, 1fr) var(--dev-level-value, 7ch) var(--dev-level-toggle, 7em);
  align-items: center; gap: 8px; }
.dev-level-row > .dev-row-control > input[type="range"] { grid-column: 1; grid-row: 1; width: 100%; min-width: 0; }
.dev-level-row > .dev-row-control > .dev-range-value { grid-column: 2; grid-row: 1; min-width: 0; overflow: hidden; white-space: nowrap;
  font: 500 11px/1 var(--dev-mono); font-variant-numeric: tabular-nums; color: var(--dev-bright); text-align: right; }
.dev-level-row > .dev-row-control > .dev-level-toggle { grid-column: 3; grid-row: 1; width: 100%; min-width: 0; }
.dev-level-note { display: block; margin-top: 1px; font: 500 10px/1.2 var(--dev-mono); font-variant-numeric: tabular-nums; color: var(--muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dev-row-label { font-size: 12px; color: #efe4cb; overflow-wrap: normal; }
.dev-row-control { min-width: 0; display: flex; align-items: center; gap: 8px; }
.dev-row-control > * { min-width: 0; }
.dev-note-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; }
.dev-note[data-tone="warning"] { color: #ffcfb7 !important; }
.dev-readout { font: 500 11.5px/1.35 var(--dev-mono); font-variant-numeric: tabular-nums; color: var(--dev-bright); overflow-wrap: anywhere; }
.dev-button-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 136px), 1fr)); gap: 6px; }
.dev-button-cell { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dev-button-cell > .dev-button { flex: 1; }
.dev-choice { display: flex; flex-wrap: wrap; gap: 4px; width: 100%; }
.dev-choice[data-display="segmented"] { flex-wrap: nowrap; gap: 0; border: 1px solid var(--line); background: var(--dev-inset); }
.dev-chip { min-height: var(--dev-chip); min-width: var(--dev-chip); padding: 3px 9px; border: 1px solid var(--dev-hairline); background: var(--dev-inset); color: var(--muted);
  font-size: 12px; line-height: 1.2; white-space: nowrap; transition: color 100ms ease-out, border-color 100ms ease-out, background-color 100ms ease-out; }
.dev-choice[data-display="segmented"] .dev-chip { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; border: 0; border-right: 1px solid var(--dev-hairline); }
.dev-choice[data-display="segmented"] .dev-chip:last-child { border-right: 0; }
.dev-chip:hover:not([aria-disabled="true"]) { color: var(--dev-bright); border-color: var(--line); }
.dev-chip[aria-checked="true"] { background: rgb(237 205 136 / 17%); border-color: var(--gold); color: var(--dev-bright); box-shadow: inset 0 0 0 1px rgb(237 205 136 / 30%); }
.dev-choice[data-display="segmented"] .dev-chip[aria-checked="true"] { box-shadow: inset 0 -2px 0 var(--gold); }

.dev-sheet .dev-chips { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; width: 100%; }
.dev-sheet .dev-chips > [role="radio"] { flex: 0 0 auto; min-height: var(--dev-chip); min-width: var(--dev-chip); margin: 0; padding: 3px 10px;
  border: 1px solid var(--dev-hairline); border-radius: 0; background: var(--dev-inset); color: var(--muted); font-size: 12px; line-height: 1.2;
  text-align: center; white-space: nowrap; overflow-wrap: normal; opacity: 1; box-shadow: none;
  transition: color 100ms ease-out, border-color 100ms ease-out, background-color 100ms ease-out; }
.dev-sheet .dev-chips > [role="radio"]:hover:not(:disabled, [aria-disabled="true"]) { color: var(--dev-bright); border-color: var(--line); background: var(--dev-inset); }
.dev-sheet .dev-chips > [role="radio"][aria-checked="true"] { background: rgb(237 205 136 / 17%); border-color: var(--gold); color: var(--dev-bright);
  box-shadow: inset 0 0 0 1px rgb(237 205 136 / 30%); }
.dev-sheet .dev-chips > [role="radio"]:is(:disabled, [aria-disabled="true"]) { opacity: .5; }
.dev-sheet .dev-chips:not(:has(> :nth-child(5))) { flex-wrap: nowrap; gap: 0; border: 1px solid var(--line); background: var(--dev-inset); }
.dev-sheet .dev-chips:not(:has(> :nth-child(5))) > [role="radio"] { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  border: 0; border-right: 1px solid var(--dev-hairline); }
.dev-sheet .dev-chips:not(:has(> :nth-child(5))) > [role="radio"]:last-child { border-right: 0; }
.dev-sheet .dev-chips:not(:has(> :nth-child(5))) > [role="radio"][aria-checked="true"] { box-shadow: inset 0 -2px 0 var(--gold); }

.dev-switch { display: inline-flex; align-items: center; gap: 8px; min-height: var(--dev-control); padding: 0; border: 0; background: transparent; color: var(--muted); }
.dev-switch-track { position: relative; width: 34px; height: 18px; flex: 0 0 auto; border: 1px solid var(--line); background: var(--dev-inset); }
.dev-switch-thumb { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; background: var(--muted); transition: transform 120ms ease-out, background-color 120ms ease-out; }
.dev-switch[aria-checked="true"] { color: var(--dev-bright); }
.dev-switch[aria-checked="true"] .dev-switch-track { border-color: var(--gold); background: rgb(237 205 136 / 22%); }
.dev-switch[aria-checked="true"] .dev-switch-thumb { transform: translateX(16px); background: var(--gold); }
.dev-switch-state { font-size: 11px; }
.dev-range-control { display: flex; align-items: center; gap: 8px; width: 100%; }
.dev-range-control > .dev-range { flex: 1; }
.dev-range-value { min-width: 4ch; font: 500 11px/1 var(--dev-mono); color: var(--dev-bright); text-align: right; }

.dev-group-body :where(div) { min-width: 0; }
.dev-group-body :where(div[data-testid]:not([class*="dev-"], [data-dev-layout="own"])) { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 8px; align-items: center; }
.dev-group-body :where(div[data-testid]:not([class*="dev-"], [data-dev-layout="own"])) > * { grid-column: 1 / -1; }
.dev-group-body :where(div[data-testid]:not([class*="dev-"], [data-dev-layout="own"])) > :where(:has(+ .dev-info-after), label:has(+ output)) { grid-column: 1; }
.dev-group-body :where(div[data-testid]:not([class*="dev-"], [data-dev-layout="own"])) > :where(.dev-info-after, label + output) { grid-column: 2; justify-self: end; }
.dev-group-body :where(div[data-testid]:not([class*="dev-"], [data-dev-layout="own"])) > :where(label + output) { min-width: 4ch; font: 500 11px/1 var(--dev-mono); color: var(--dev-bright); text-align: right; }
.dev-group-body :where(div[hidden]) { display: none; }
.dev-group-body :where(label:not(.dev-row-label)) { display: grid; grid-template-columns: var(--dev-label-column) minmax(0, 1fr); grid-auto-flow: column;
  grid-auto-columns: auto; align-items: center; gap: 4px 8px; min-height: var(--dev-control); font-size: 12px; color: #efe4cb; }
.dev-group-body :where(label:not(.dev-row-label):has(> input[type="range"])) { grid-auto-flow: row; grid-template-columns: var(--dev-label-column) minmax(0, 1fr) 18px 18px; }
.dev-group-body :where(label:not(.dev-row-label):has(> input[type="range"])) > :where(input[type="checkbox"]) { grid-column: 3; grid-row: 1; }
.dev-group-body :where(label:not(.dev-row-label):has(> input[type="range"])) > :where(.dev-info) { grid-column: 4; grid-row: 1; margin: 0; }
.dev-group-body :where(label:not(.dev-row-label):has(> input[type="checkbox"]:first-child, > input[type="radio"]:first-child)) { display: flex; gap: 9px; cursor: pointer; }
.dev-group-body :where(select, textarea, input:not([type]), input[type="text"], input[type="number"], input[type="search"]) {
  width: 100%; min-width: 0; min-height: var(--dev-control); padding: 0 8px; border: 1px solid var(--line); border-radius: 0;
  background: var(--dev-inset); color: var(--dev-text); font: inherit; font-size: 12px; text-overflow: ellipsis; }
.dev-group-body :where(select:hover:enabled) { border-color: var(--gold); }
.dev-group-body :where(input[type="range"]) { width: 100%; min-width: 0; min-height: var(--dev-control); margin: 0; accent-color: var(--gold); }
.dev-group-body :where(input[type="checkbox"], input[type="radio"]) { width: 18px; height: 18px; margin: 0; flex: 0 0 auto; accent-color: var(--gold); }
.dev-group-body :where(p) { margin: 0; max-width: 72ch; font-size: 11.5px; line-height: 1.45; color: var(--muted); overflow-wrap: anywhere; }
.dev-group-body :where(p[role="status"], output) { color: #f1e3c4; }
.dev-group-body :where(p[hidden]) { display: none; }
.dev-group-body :where(.secondary-actions) { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 136px), 1fr)); gap: 6px; }
.dev-group-body :where(button:not(.dev-info, .dev-chip, .dev-switch)) { min-height: var(--dev-control); padding: 6px 10px;
  border: 1px solid var(--line); background: #2b3530; font-size: 12px; line-height: 1.2; text-align: center; white-space: normal;
  overflow-wrap: anywhere; transition: background-color 120ms ease-out, border-color 120ms ease-out; }
.dev-group-body :where(button:not(.dev-info, .dev-chip, .dev-switch):hover:enabled) { background: #3b4840; border-color: var(--gold); }
.dev-group-body :where(button:not(.dev-info, .dev-chip, .dev-switch):active:enabled) { background: #79704a; }
.dev-group-body :where(button[aria-pressed="true"]) { border-color: var(--gold); background: #4a3e25; }

.dev-info { position: relative; display: inline-grid; place-items: center; width: 18px; height: 18px; flex: 0 0 auto; padding: 0;
  border: 1px solid var(--dev-hairline); border-radius: 50%; background: transparent; color: var(--muted);
  font: italic 600 11px/1 Georgia, "Times New Roman", serif; cursor: help; transition: opacity 120ms ease-out; }
.dev-info::before { content: ""; position: absolute; inset: -9px; }
.dev-info:hover, .dev-info[aria-expanded="true"] { color: var(--gold); border-color: var(--gold); background: rgb(237 205 136 / 10%); }
.dev-group-body [data-dev-described]:has(> .dev-info-corner) { position: relative; padding-right: 30px; }
.dev-info-corner { position: absolute; top: 7px; right: 0; }
.dev-info-after { justify-self: start; margin-left: 4px; vertical-align: middle; }
.dev-sheet [data-dev-described] { -webkit-touch-callout: none; }
@media (hover: hover) and (pointer: fine) {
  .dev-sheet[data-mode="side"] .dev-info { opacity: .42; }
  .dev-sheet[data-mode="side"] :is(.dev-row, .dev-note-row, .dev-button-cell, .dev-group-heading, [data-dev-described]):hover .dev-info,
  .dev-sheet[data-mode="side"] [data-dev-described]:hover + .dev-info-after,
  .dev-sheet[data-mode="side"] .dev-info:is(:hover, :focus-visible, [aria-expanded="true"]) { opacity: 1; }
}

.dev-sheet[data-mode="bottom"] { --dev-control: 44px; --dev-chip: 44px; --dev-label-column: 7.5em; }
@media (pointer: coarse) {
  .dev-sheet { --dev-control: 44px; --dev-chip: 44px; } .dev-info::before { inset: -13px; } .dev-tab { min-height: 44px; }
  .dev-sheet :is(.dev-filter input, select, textarea, input:not([type]), input[type="text"], input[type="search"], input[type="number"]) { font-size: 16px; }
}
.dev-sheet[data-mode="bottom"] :is(.dev-filter input, select, textarea, input:not([type]), input[type="text"], input[type="search"], input[type="number"]) { font-size: 16px; }
.dev-sheet[data-mode="bottom"] .dev-tab { min-height: 44px; padding-inline: 10px; }
.dev-sheet[data-mode="bottom"] .dev-info::before { inset: -13px; }
.dev-sheet[data-mode="bottom"] :is(.dev-chip, .dev-chips > [role="radio"]) { padding-inline: 12px; }
.dev-sheet[data-mode="bottom"] .dev-row.dev-level-row { grid-template-columns: minmax(0, 1fr); row-gap: 0; }
.dev-sheet[data-mode="bottom"] .dev-level-row { --dev-level-toggle: 8em; }
.dev-sheet[data-mode="bottom"] .dev-level-row > .dev-row-label { min-height: 22px; display: flex; align-items: baseline; gap: 8px; padding-top: 4px; }
.dev-sheet[data-mode="bottom"] .dev-level-note { display: inline; margin-top: 0; }

.dev-sheet[data-mode="bottom"] .dev-sheet-header { padding: 0 6px 4px 12px; gap: 6px; background: none; touch-action: none; }
.dev-sheet[data-mode="bottom"] .dev-sheet-heading > svg { display: none; }
.dev-sheet[data-mode="bottom"] .dev-sheet-titles h2 { font-size: 18px; }
.dev-sheet[data-mode="bottom"] .dev-sheet-status { display: none; }
.dev-sheet[data-mode="bottom"] .dev-sheet-header[data-flash] .dev-sheet-titles h2 { display: none; }
.dev-sheet[data-mode="bottom"] .dev-sheet-header[data-flash] .dev-sheet-status { display: block; font-size: 12px; }
.dev-sheet[data-mode="bottom"] .dev-sheet-toolbar { display: flex; align-items: center; gap: 6px; padding: 4px 6px 6px 12px; }
.dev-sheet[data-mode="bottom"] .dev-tabs { flex: 1 1 auto; }
.dev-sheet[data-mode="bottom"] .dev-filter { flex: 0 0 var(--dev-control); width: var(--dev-control); }
.dev-sheet[data-mode="bottom"] .dev-filter-field { justify-content: center; padding: 0; }
.dev-sheet[data-mode="bottom"] .dev-filter input { flex: 0 0 0; width: 0; }
.dev-sheet[data-mode="bottom"][data-filter-open] .dev-filter { flex: 1 1 62%; width: auto; }
.dev-sheet[data-mode="bottom"][data-filter-open] .dev-filter-field { justify-content: flex-start; padding: 0 10px; }
.dev-sheet[data-mode="bottom"][data-filter-open] .dev-filter input { flex: 1 1 auto; width: auto; }
.dev-sheet[data-mode="bottom"][data-filter-open] .dev-tabs { flex: 1 1 38%; }
.dev-sheet[data-mode="bottom"] .dev-sheet-body { padding-top: 0; }

@container (max-width: 270px) {
  .dev-row[data-layout="inline"] { grid-template-columns: minmax(0, 1fr) auto; }
  .dev-row[data-layout="inline"] > .dev-row-control { grid-column: 1 / -1; grid-row: 2; }
  .dev-group-body :where(label:not(.dev-row-label)) { grid-template-columns: minmax(0, 1fr); grid-auto-flow: row; }
}
@media (max-height: 500px) and (orientation: landscape) {
  .dev-sheet-header { padding-block: 5px; }
  .dev-sheet-titles h2 { font-size: 18px; }
  .dev-sheet-toolbar { padding-block: 5px 6px; gap: 6px; }
}

.dev-hovercard { position: fixed; z-index: 30; left: 0; top: 0; width: max-content; max-width: min(320px, calc(100vw - 16px));
  max-height: 40vh; overflow-y: auto; overscroll-behavior: contain; padding: 9px 12px; pointer-events: auto;
  background: rgb(13 16 15 / 97%); border: 1px solid var(--bronze); font-size: 12px; line-height: 1.4;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 65%), 0 14px 30px rgb(0 0 0 / 50%); scrollbar-width: thin; scrollbar-color: var(--bronze) transparent; }
.dev-hovercard:is([data-trigger="hover"], [data-trigger="focus"]) { pointer-events: none; }
.dev-hovercard::before { content: ""; position: absolute; inset: 2px; border: 1px solid rgb(237 205 136 / 13%); pointer-events: none; }
.dev-hovercard[hidden] { display: none; }
.dev-hovercard-head { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 3px; }
.dev-hovercard-title { flex: 1; min-width: 0; display: block; font: 600 16px/1.15 "Cormorant Garamond Variable", Georgia, serif; color: #ffe3a5; text-wrap: balance; }
.dev-hovercard-close { position: relative; flex: 0 0 auto; display: inline-grid; place-items: center; width: 26px; height: 26px; margin: -3px -5px 0 0;
  padding: 0; border: 1px solid var(--dev-hairline); background: transparent; color: var(--muted); font: 400 18px/1 "Segoe UI", system-ui, sans-serif; cursor: pointer; }
.dev-hovercard-close::before { content: ""; position: absolute; inset: -9px; }
.dev-hovercard-close:hover { color: var(--gold); border-color: var(--gold); }
@media (pointer: coarse) { .dev-hovercard-close { width: 36px; height: 36px; margin: -6px -8px 0 0; } }
.dev-hovercard-description { margin: 0 0 6px; color: var(--muted); font-size: 11.5px; line-height: 1.45; }
.dev-hovercard:is([data-trigger="hover"], [data-trigger="focus"]) .dev-hovercard-description {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; line-clamp: 4; overflow: hidden; }
.dev-variables { display: grid; margin: 0; padding: 2px 0 0; border-top: 1px solid rgb(191 167 111 / 26%); }
.dev-variable { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 10px; padding: 5px 0; }
.dev-variable + .dev-variable { border-top: 1px dashed rgb(191 167 111 / 18%); }
.dev-variable-name { flex: 0 1 auto; min-width: 0; margin: 0; }
.dev-variable-name code { font: 11px/1.3 var(--dev-mono); color: #e9dcc0; overflow-wrap: normal; word-break: normal; }
.dev-variable-data { flex: 1 1 auto; min-width: 0; max-width: 100%; display: flex; flex-wrap: wrap; align-items: baseline; justify-content: flex-end; gap: 3px 6px; margin: 0; text-align: right; }
.dev-variable-value { min-width: 0; font: 600 11px/1.3 var(--dev-mono); font-variant-numeric: tabular-nums; color: var(--dev-bright); overflow-wrap: anywhere; }
.dev-variable-meta { flex: 1 1 100%; margin: 1px 0 0; color: var(--muted); font-size: 10.5px; line-height: 1.45; }
.dev-variable-meta summary { width: fit-content; color: var(--bronze); font-size: 10.5px; letter-spacing: .06em; cursor: pointer; }
.dev-variable-meta summary:hover { color: var(--gold); }
.dev-variable-meta details > span { display: block; margin-top: 3px; overflow-wrap: anywhere; }
.dev-meta-label { color: var(--bronze); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.dev-badge { display: inline-block; padding: 0 5px; border: 1px solid currentColor; font-size: 10px; font-weight: 600; letter-spacing: .06em;
  line-height: 15px; text-transform: uppercase; white-space: nowrap; }
.dev-badge[data-status="native"] { color: var(--dev-native); background: rgb(143 199 173 / 8%); }
.dev-badge[data-status="presentation"] { color: var(--dev-presentation); background: rgb(237 205 136 / 8%); }
.dev-badge[data-status="unverified"] { color: var(--dev-unverified); background: rgb(227 161 127 / 9%); }
.dev-hovercard-hint { margin: 5px 0 0; color: rgb(208 198 175 / 72%); font-size: 10.5px; font-style: italic; }
@media (pointer: coarse) { .dev-hovercard :is(.dev-badge, .dev-meta-label, .dev-hovercard-hint) { font-size: 10.5px; } }

@media (prefers-reduced-motion: reduce) {
  .dev-sheet, .dev-sheet *, .dev-hovercard { transition: none !important; animation: none !important; }
}
`;
