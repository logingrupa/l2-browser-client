/** Filter rules: a query is split into lower-case tokens and every token must
 * occur in a row's label, visible text, ARIA labels, moved title text or
 * described variable names (never in <style>/<script> text).
 *
 * Rows are the direct children of a group body. Row containers contribute
 * each child as its own row so one control can match on its own:
 * - button rows (`.secondary-actions`, `.dev-button-grid`, `[data-dev-rows]`)
 * - plain owner-module roots (an element with a data-testid whose class does
 *   not start with `dev-`), e.g. the footstep, audio or combat modules. When
 *   the root itself matches (its hover-card variables or test id), every
 *   child shows.
 * An auto (i) button shares the visibility of the row before it. */

export const filteredOutAttribute = "data-dev-filtered";

export function queryTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).map(token => token.trim()).filter(Boolean);
}

export function matchesTokens(text: string, tokens: readonly string[]): boolean {
  if (!tokens.length) return true;
  const haystack = text.toLowerCase();
  return tokens.every(token => haystack.includes(token));
}

const searchedAttributes = ["aria-label", "title", "data-dev-title", "data-dev-search", "data-testid"] as const;
const skippedTags = new Set(["STYLE", "SCRIPT", "TEMPLATE"]);

function attributeText(element: Element): string {
  const parts: string[] = [];
  for (const name of searchedAttributes) {
    const value = element.getAttribute(name);
    if (value) parts.push(value);
  }
  return parts.join(" ");
}

/** Visible text plus searchable attributes of the element and its descendants. */
function collect(node: Node, parts: string[]): void {
  if (node.nodeType === 3) { if (node.textContent) parts.push(node.textContent); return; }
  if (node.nodeType !== 1) return;
  const element = node as Element;
  if (skippedTags.has(element.tagName)) return;
  const attributes = attributeText(element);
  if (attributes) parts.push(attributes);
  for (const child of Array.from(element.childNodes)) collect(child, parts);
}

export function searchText(element: Element): string {
  const parts: string[] = [];
  collect(element, parts);
  return parts.join(" ").replace(/\s+/g, " ");
}

function isButtonRow(element: Element): boolean {
  return element.classList.contains("secondary-actions") || element.classList.contains("dev-button-grid") || element.hasAttribute("data-dev-rows");
}

function isModuleRoot(element: Element): boolean {
  if (!element.hasAttribute("data-testid") || element.children.length < 2) return false;
  return !(element.getAttribute("class") ?? "").split(/\s+/).some(name => name.startsWith("dev-"));
}

function isRowContainer(element: Element, depth: number): boolean {
  return isButtonRow(element) || (depth === 0 && isModuleRoot(element));
}

const isInfoButton = (element: Element) => element.classList.contains("dev-info");

/** Elements that the filter shows or hides inside one group body. */
export function filterRows(body: Element): Element[] {
  const rows: Element[] = [];
  const walk = (parent: Element, depth: number) => {
    for (const child of Array.from(parent.children)) {
      if (child.classList.contains("dev-hovercard") || skippedTags.has(child.tagName)) continue;
      if (depth < 2 && isRowContainer(child, depth)) walk(child, depth + 1);
      else rows.push(child);
    }
  };
  walk(body, 0);
  return rows;
}

/** Applies tokens to one container's children. Returns how many rows match. */
function filterChildren(parent: Element, tokens: readonly string[], force: boolean, depth: number): number {
  let matches = 0, previousVisible = true;
  for (const child of Array.from(parent.children)) {
    if (skippedTags.has(child.tagName) || child.classList.contains("dev-hovercard")) continue;
    if (isInfoButton(child)) { setFilteredOut(child, !previousVisible); continue; }
    if (depth < 2 && isRowContainer(child, depth)) {
      const own = force || matchesTokens(attributeText(child), tokens);
      const inner = filterChildren(child, tokens, own, depth + 1);
      const visible = inner > 0 || child.children.length === 0;
      setFilteredOut(child, !visible);
      matches += inner; previousVisible = visible;
      continue;
    }
    const visible = force || matchesTokens(searchText(child), tokens);
    setFilteredOut(child, !visible); if (visible) matches++;
    previousVisible = visible;
  }
  return matches;
}

/** Applies tokens to one group body. `force` shows every row (the group or
 * section title matched). Returns how many rows match. */
export function applyRowFilter(body: Element, tokens: readonly string[], force: boolean): number {
  return filterChildren(body, tokens, force, 0);
}

export function clearRowFilter(root: Element): void {
  for (const element of Array.from(root.querySelectorAll(`[${filteredOutAttribute}]`))) element.removeAttribute(filteredOutAttribute);
}

export function setFilteredOut(element: Element, out: boolean): void {
  if (out) element.setAttribute(filteredOutAttribute, "out");
  else element.removeAttribute(filteredOutAttribute);
}
