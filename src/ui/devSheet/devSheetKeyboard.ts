import type { DevSection } from "./devSheetParts";
import type { DevSheetState } from "./devSheetState";
import type { DevHoverCards } from "./hoverCards";

const arrowNavigationKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
const nonTypingInputTypes = ["range", "checkbox", "radio", "button", "submit", "reset", "color"];

export function isTypingTarget(target: Element | null): boolean {
  if (!target) return false;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  if (target.tagName === "INPUT") return !nonTypingInputTypes.includes((target.getAttribute("type") ?? "text").toLowerCase());
  return (target as HTMLElement).isContentEditable === true;
}

function steppedIndex(key: string, index: number, count: number): number {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return (index + (key === "ArrowRight" || key === "ArrowDown" ? 1 : -1) + count) % count;
}

export function handleTabKey(event: KeyboardEvent, navigableSections: () => DevSection[], current: () => DevSection | undefined,
  activate: (sectionId: string) => void): void {
  if (!arrowNavigationKeys.includes(event.key)) return;
  const sorted = navigableSections();
  const active = current();
  if (!sorted.length) return;
  event.preventDefault();
  const index = Math.max(0, sorted.findIndex(section => section === active));
  const section = sorted[steppedIndex(event.key, index, sorted.length)]!;
  activate(section.id); section.tab.focus();
}

export function handleChipKey(event: KeyboardEvent): void {
  if (!arrowNavigationKeys.includes(event.key)) return;
  const target = event.target instanceof Element ? event.target : null;
  const chip = target?.closest<HTMLElement>("[role='radio']");
  const group = chip?.parentElement;
  if (!chip || !group || !group.classList.contains("dev-chips")) return;
  const chips = (Array.from(group.children) as HTMLElement[]).filter(item => item.getAttribute("role") === "radio" &&
    !item.hasAttribute("disabled") && item.getAttribute("aria-disabled") !== "true");
  if (!chips.length) return;
  event.preventDefault();
  const item = chips[steppedIndex(event.key, Math.max(0, chips.indexOf(chip)), chips.length)]!;
  item.focus();
  if (item.getAttribute("aria-checked") !== "true") item.click();
}

export interface DevSheetKeyContext {
  readonly state: DevSheetState;
  readonly sheet: HTMLElement;
  readonly filterInput: HTMLInputElement;
  readonly cards: DevHoverCards;
  setFilter(query: string): void;
  close(): void;
  toggle(): void;
  openFilter(): void;
}

export function handleSheetKey(event: KeyboardEvent, context: DevSheetKeyContext): void {
  if (event.defaultPrevented) return;
  const target = event.target instanceof Element ? event.target : null;
  if (event.key === "Escape") {
    if (target?.closest("dialog")) return;
    if (context.cards.isOpen) { context.cards.hide(); event.preventDefault(); return; }
    if (target === context.filterInput && context.filterInput.value) { context.setFilter(""); event.preventDefault(); return; }
    if (!context.state.open) return;
    if (context.state.pinned && !(target && context.sheet.contains(target))) return;
    event.preventDefault(); context.close();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(target) || target?.closest("dialog")) return;
  if (event.key === "`") { event.preventDefault(); context.toggle(); return; }
  if (event.key === "/" && context.state.open) { event.preventDefault(); context.openFilter(); }
}
