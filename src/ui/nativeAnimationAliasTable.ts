import type { NativeAliasCoverage, NativeAliasCoverageRow } from "../assets/native/nativeAnimationAliases";
import type { DevInfo, VariableInfo } from "./devSheet/types";
import type { DescribeOptions } from "./devSheet/hoverCards";

export interface NativeAliasTableOptions {
  readonly coverage: NativeAliasCoverage;
  readonly profileName: string;
  readonly packageLabel: string;
  readonly archiveSha256: string | null;
  readonly family: string | null;
  readonly play: (clip: string) => string | null;
  readonly previewing: () => string | null;
  readonly describe: (element: Element, info: DevInfo, options?: DescribeOptions) => () => void;
  readonly onStatus?: (message: string) => void;
  readonly signal: AbortSignal;
}

const styles = String.raw`
.native-alias-table { display: block; }
.native-alias-list { display: grid; gap: 1px; background: var(--dev-hairline, rgb(191 167 111 / 20%)); border: 1px solid var(--dev-hairline, rgb(191 167 111 / 20%)); }
.native-alias-row { display: grid; grid-template-columns: minmax(5.2em, 7.2em) minmax(0, 1fr) auto; align-items: center; gap: 6px;
  min-height: 28px; padding: 1px 6px 1px 8px; background: var(--dev-inset, #141917); }
.native-alias-name { font: 500 11px/1.2 var(--dev-mono, monospace); color: #efe4cb; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.native-alias-cell { min-width: 0; display: flex; align-items: center; gap: 6px; }
.native-alias-table button.native-alias-play { display: flex; align-items: center; justify-content: flex-start; gap: 6px; width: 100%; min-width: 0;
  min-height: 24px; padding: 2px 6px; border: 1px solid transparent; background: transparent; color: var(--dev-bright, #fff1cf);
  font: 500 11px/1.2 var(--dev-mono, monospace); text-align: left; white-space: nowrap; overflow: hidden; }
.native-alias-table button.native-alias-play > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.native-alias-table button.native-alias-play svg { width: 11px; height: 11px; fill: currentColor; stroke: none; color: var(--gold, #edcd88); }
.native-alias-table button.native-alias-play:hover:enabled { border-color: var(--line, #6f5a3a); background: #2b3530; }
.native-alias-table button.native-alias-play[aria-pressed="true"] { border-color: var(--gold, #edcd88); background: rgb(237 205 136 / 14%); }
.native-alias-tag { flex: 0 0 auto; padding: 0 4px; border: 1px solid var(--dev-hairline, rgb(191 167 111 / 20%)); color: var(--muted, #b9ae96);
  font: 600 9.5px/1.5 var(--dev-mono, monospace); letter-spacing: .04em; text-transform: uppercase; }
.native-alias-missing { min-width: 0; padding: 2px 6px; color: var(--dev-unverified, #e3a17f); font-size: 11px; line-height: 1.3; overflow-wrap: anywhere; }
.native-alias-missing b { font-weight: 600; color: #ffcfb7; }
.native-alias-row[data-unbound] { background: rgb(227 161 127 / 8%); }
.dev-sheet[data-mode="bottom"] .native-alias-row { min-height: 44px; }
.dev-sheet[data-mode="bottom"] .native-alias-table button.native-alias-play { min-height: 40px; }
@media (pointer: coarse) { .native-alias-row { min-height: 44px; } .native-alias-table button.native-alias-play { min-height: 40px; } }
`;

const playIcon = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z"/></svg>';
const shortSha = (value: string | null) => value ? `${value.slice(0, 12)}…` : "unknown";

function keepOwnGridOutsideSheetHostedModuleLayout(element: HTMLElement): void {
  element.dataset.devLayout = "own";
}

export function attachNativeAnimationAliasTable(host: HTMLElement, options: NativeAliasTableOptions) {
  const root = document.createElement("div");
  root.className = "native-alias-table"; root.dataset.testid = "native-animation-aliases";
  keepOwnGridOutsideSheetHostedModuleLayout(root);
  root.setAttribute("role", "table"); root.setAttribute("aria-label", `Animation aliases of ${options.profileName}`);
  const style = document.createElement("style"); style.textContent = styles;
  const list = document.createElement("div"); list.className = "native-alias-list"; list.setAttribute("data-dev-rows", ""); list.setAttribute("role", "rowgroup");
  root.append(style, list);
  const disposers: (() => void)[] = [], buttons: HTMLButtonElement[] = [];
  for (const row of options.coverage.rows) {
    const element = document.createElement("div");
    element.className = "native-alias-row"; element.setAttribute("role", "row");
    element.dataset.alias = row.alias; element.dataset.status = row.status; element.dataset.testid = `native-alias-${row.alias}`;
    keepOwnGridOutsideSheetHostedModuleLayout(element);
    const name = document.createElement("span"); name.className = "native-alias-name"; name.setAttribute("role", "rowheader");
    name.textContent = row.alias; name.dataset.devSearch = `${row.alias} ${row.key} ${row.group}`;
    const cell = document.createElement("span"); cell.className = "native-alias-cell"; cell.setAttribute("role", "cell");
    const clip = row.nativeClip;
    if (clip) {
      const play = document.createElement("button"); play.type = "button"; play.className = "native-alias-play";
      play.dataset.clip = clip; play.setAttribute("aria-pressed", "false");
      play.setAttribute("aria-label", `Play ${clip} (${row.alias})`);
      play.innerHTML = playIcon;
      const text = document.createElement("span"); text.textContent = clip; play.append(text);
      play.addEventListener("click", () => {
        const failure = options.play(clip);
        if (failure) options.onStatus?.(failure);
        refresh();
      }, { signal: options.signal });
      cell.append(play); buttons.push(play);
      const tag = tagFor(row);
      if (tag) { const badge = document.createElement("span"); badge.className = "native-alias-tag"; badge.textContent = tag; cell.append(badge); }
    } else {
      element.dataset.unbound = "";
      const missing = document.createElement("span"); missing.className = "native-alias-missing";
      const strong = document.createElement("b"); strong.textContent = "no native clip";
      missing.append(strong, ` · ${row.summary ?? "unbound"}`);
      cell.append(missing);
    }
    const infoCell = document.createElement("span"); infoCell.setAttribute("role", "cell");
    const info = document.createElement("button"); info.type = "button"; info.className = "dev-info"; info.textContent = "i";
    info.setAttribute("aria-label", `About ${row.alias}`); info.setAttribute("aria-expanded", "false");
    infoCell.append(info);
    element.append(name, cell, infoCell);
    list.append(element);
    disposers.push(options.describe(element, rowInfo(row, options), { infoButton: info }));
  }
  host.append(root);
  const refresh = () => {
    const playing = options.previewing();
    for (const button of buttons) {
      const pressed = String(playing !== null && button.dataset.clip === playing);
      if (button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
    }
  };
  const timer = setInterval(refresh, 300);
  const dispose = () => { clearInterval(timer); for (const release of disposers.splice(0)) release(); root.remove(); };
  options.signal.addEventListener("abort", dispose, { once: true });
  return { element: root, refresh, dispose };
}

function tagFor(row: NativeAliasCoverageRow): string | null {
  if (row.status === "no-evidence") return "no evidence";
  return null;
}

function rowInfo(row: NativeAliasCoverageRow, options: NativeAliasTableOptions): DevInfo {
  const clip = row.nativeClip;
  const where = row.reference ? `${row.reference}${row.line ? ` (LineageWarrior.int line ${row.line})` : ""}` : "no localized value";
  const description = clip
    ? `${row.key}${options.family ? ` (${options.family} family)` : ""} → ${clip}. Tap the clip to play it once on your character; the requested state resumes after it.`
    : row.reason ?? "No native clip is bound to this alias.";
  const variables = (): VariableInfo[] => [
    { name: "alias.key", value: () => row.key, values: `${row.field}[index]`, source: where, status: "native" },
    { name: "alias.clip", value: () => clip ?? "none (unbound)", values: "exact package clip or none", source: `${options.packageLabel} · archive ${shortSha(options.archiveSha256)}`, status: "native" },
    { name: "alias.status", value: () => `${row.status}${row.selectionPath ? ` · ${row.selectionPath}` : ""}`,
      values: "exact | case-only | no-family-value | missing-clip | conflict-unresolved · base-class-direct-getter | unverified",
      source: "scripts/report-native-animation-aliases.py → prepare-native-player-aliases.py (staged aliasEvidence)",
      status: row.status === "no-evidence" || row.selectionPath === "unverified" ? "unverified" : "native" },
    ...(clip ? [{ name: "alias.preview", value: () => options.previewing() === clip ? "playing" : "stopped", values: "playing | stopped",
      source: "browser clip preview: one pass on the local actor, never a world-state change (presentation choice - native dispatch unverified)", status: "presentation" as const }] : []),
  ];
  return { title: `${row.alias} · ${row.key}`, description, variables };
}
