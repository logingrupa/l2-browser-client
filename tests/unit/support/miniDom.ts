/** A deliberately small DOM for vitest (no jsdom/happy-dom is installed).
 * Supports what the developer sheet and HUD use: element trees, attributes,
 * dataset/classList/style, innerHTML parsing of simple markup, a selector
 * subset (tag, #id, .class, [attr], [attr="v"], descendant and `>`), event
 * capture/target/bubble with AbortSignal listeners, focus and click. */
import { vi } from "vitest";

interface Listener { callback: EventListenerOrEventListenerObject; capture: boolean; once: boolean }

export class FakeEvent {
  type: string; bubbles: boolean; cancelable: boolean;
  target: unknown = null; currentTarget: unknown = null; defaultPrevented = false; timeStamp: number;
  key = ""; pointerType = "mouse"; pointerId = 1; clientX = 0; clientY = 0; button = 0;
  ctrlKey = false; metaKey = false; altKey = false; shiftKey = false; relatedTarget: unknown = null;
  stopped = false; stoppedImmediately = false;
  constructor(type: string, init: Partial<Omit<FakeEvent, "type">> & { bubbles?: boolean } = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? !["focus", "blur", "pointerenter", "pointerleave", "mouseenter", "mouseleave"].includes(type);
    this.cancelable = true;
    this.timeStamp = init.timeStamp ?? Date.now();
    Object.assign(this, init);
  }
  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this.stopped = true; }
  stopImmediatePropagation(): void { this.stopped = true; this.stoppedImmediately = true; }
}

export class FakeEventTarget {
  private readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    if (!callback) return;
    const capture = typeof options === "boolean" ? options : options?.capture ?? false;
    const signal = typeof options === "object" ? options.signal : undefined;
    if (signal?.aborted) return;
    const list = this.listeners.get(type) ?? [];
    if (list.some(item => item.callback === callback && item.capture === capture)) return;
    list.push({ callback, capture, once: typeof options === "object" && options.once === true });
    this.listeners.set(type, list);
    signal?.addEventListener("abort", () => this.removeEventListener(type, callback, { capture }), { once: true });
  }
  removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    const capture = typeof options === "boolean" ? options : options?.capture ?? false;
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(type, list.filter(item => !(item.callback === callback && item.capture === capture)));
  }
  listenerCount(type: string): number { return this.listeners.get(type)?.length ?? 0; }
  invoke(event: FakeEvent | Event, phase: "capture" | "target" | "bubble"): void {
    const list = [...(this.listeners.get(event.type) ?? [])];
    const ordered = phase === "target" ? [...list.filter(item => item.capture), ...list.filter(item => !item.capture)] : list;
    for (const listener of ordered) {
      if (phase === "capture" && !listener.capture) continue;
      if (phase === "bubble" && listener.capture) continue;
      if ((event as FakeEvent).stoppedImmediately) break;
      if (event instanceof FakeEvent) event.currentTarget = this;
      if (listener.once) this.removeEventListener(event.type, listener.callback, { capture: listener.capture });
      if (typeof listener.callback === "function") listener.callback.call(this, event as Event);
      else listener.callback.handleEvent(event as Event);
    }
  }
  dispatchEvent(event: FakeEvent | Event): boolean {
    this.invoke(event, "target");
    return !(event as FakeEvent).defaultPrevented;
  }
}

export class FakeNode extends FakeEventTarget {
  parentNode: FakeNode | null = null;
  readonly childNodes: FakeNode[] = [];
  constructor(readonly nodeType: number, readonly ownerDocument: FakeDocument | null) { super(); }
  get parentElement(): FakeElement | null { return this.parentNode instanceof FakeElement ? this.parentNode : null; }
  get textContent(): string { return this.childNodes.map(node => node.textContent).join(""); }
  set textContent(value: string) { this.replaceChildren(String(value)); }
  get isConnected(): boolean {
    for (let node: FakeNode | null = this; node; node = node.parentNode) if (node instanceof FakeDocument) return true;
    return false;
  }
  private adopt(nodes: (FakeNode | string)[]): FakeNode[] {
    return nodes.map(node => {
      const item = typeof node === "string" ? new FakeText(node, this.ownerDocument ?? (this as unknown as FakeDocument)) : node;
      item.parentNode?.removeChild(item);
      item.parentNode = this;
      return item;
    });
  }
  removeChild(node: FakeNode): FakeNode {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  append(...nodes: (FakeNode | string)[]): void { this.childNodes.push(...this.adopt(nodes)); }
  appendChild<T extends FakeNode>(node: T): T { this.append(node); return node; }
  prepend(...nodes: (FakeNode | string)[]): void { this.childNodes.unshift(...this.adopt(nodes)); }
  insertBefore<T extends FakeNode>(node: T, reference: FakeNode | null): T {
    if (!reference) { this.append(node); return node; }
    const [item] = this.adopt([node]);
    this.childNodes.splice(this.childNodes.indexOf(reference), 0, item!);
    return node;
  }
  replaceChildren(...nodes: (FakeNode | string)[]): void {
    for (const child of [...this.childNodes]) this.removeChild(child);
    this.append(...nodes);
  }
  before(...nodes: (FakeNode | string)[]): void {
    const parent = this.parentNode; if (!parent) return;
    for (const node of nodes) parent.insertBefore(typeof node === "string" ? new FakeText(node, this.ownerDocument!) : node, this);
  }
  after(...nodes: (FakeNode | string)[]): void {
    const parent = this.parentNode; if (!parent) return;
    let reference: FakeNode | null = parent.childNodes[parent.childNodes.indexOf(this) + 1] ?? null;
    for (const node of nodes) {
      const item = typeof node === "string" ? new FakeText(node, this.ownerDocument!) : node;
      parent.insertBefore(item, reference); reference = parent.childNodes[parent.childNodes.indexOf(item) + 1] ?? null;
    }
  }
  remove(): void { this.parentNode?.removeChild(this); }
  contains(node: unknown): boolean {
    for (let item = node as FakeNode | null; item; item = item.parentNode) if (item === this) return true;
    return false;
  }
  get children(): FakeElement[] { return this.childNodes.filter((node): node is FakeElement => node instanceof FakeElement); }
  get firstElementChild(): FakeElement | null { return this.children[0] ?? null; }
  get lastElementChild(): FakeElement | null { return this.children.at(-1) ?? null; }
  querySelectorAll(selector: string): FakeElement[] {
    const selectors = parseSelectorList(selector), found: FakeElement[] = [];
    const walk = (node: FakeNode) => {
      for (const child of node.children) { if (selectors.some(item => matchesComplex(child, item, this))) found.push(child); walk(child); }
    };
    walk(this);
    return found;
  }
  querySelector(selector: string): FakeElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  /** Element events propagate through ancestors, the document and window. */
  override dispatchEvent(event: FakeEvent | Event): boolean {
    if (!(event instanceof FakeEvent)) return super.dispatchEvent(event);
    event.target = this;
    const path: FakeEventTarget[] = [];
    for (let node = this.parentNode; node; node = node.parentNode) path.push(node);
    const view = (this.ownerDocument ?? (this instanceof FakeDocument ? this : null))?.defaultView;
    if (view && path.at(-1) instanceof FakeDocument) path.push(view);
    for (const node of [...path].reverse()) { node.invoke(event, "capture"); if (event.stopped) return !event.defaultPrevented; }
    this.invoke(event, "target");
    if (event.bubbles) for (const node of path) { if (event.stopped) break; node.invoke(event, "bubble"); }
    return !event.defaultPrevented;
  }
}

export class FakeText extends FakeNode {
  constructor(public data: string, document: FakeDocument) { super(3, document); }
  override get textContent(): string { return this.data; }
  override set textContent(value: string) { this.data = value; }
}

const camelToKebab = (value: string) => value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
const kebabToCamel = (value: string) => value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

class FakeStyle {
  [key: string]: unknown;
  // Unset longhands read as "" like CSSStyleDeclaration.
  width = ""; height = ""; left = ""; top = ""; inset = ""; visibility = ""; clipPath = "";
  private readonly properties = new Map<string, string>();
  setProperty(name: string, value: string): void { this.properties.set(name, value); }
  getPropertyValue(name: string): string { return this.properties.get(name) ?? String(this[kebabToCamel(name)] ?? ""); }
  removeProperty(name: string): string { const value = this.getPropertyValue(name); this.properties.delete(name); return value; }
}

export class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly style = new FakeStyle();
  scrollTop = 0;
  rect = { left: 0, top: 0, width: 0, height: 0 };
  private valueState: string | undefined;
  checked = false;
  private selectedState = false;
  readonly dataset: Record<string, string | undefined>;
  readonly classList: { add(...names: string[]): void; remove(...names: string[]): void; contains(name: string): boolean; toggle(name: string, force?: boolean): boolean };

  constructor(tag: string, document: FakeDocument) {
    super(1, document);
    this.tagName = tag.toUpperCase();
    this.dataset = new Proxy({} as Record<string, string | undefined>, {
      get: (_, key) => typeof key === "string" ? this.getAttribute(`data-${camelToKebab(key)}`) ?? undefined : undefined,
      set: (_, key, value) => { if (typeof key === "string") this.setAttribute(`data-${camelToKebab(key)}`, String(value)); return true; },
      deleteProperty: (_, key) => { if (typeof key === "string") this.removeAttribute(`data-${camelToKebab(key)}`); return true; },
      has: (_, key) => typeof key === "string" && this.hasAttribute(`data-${camelToKebab(key)}`),
    });
    const names = () => (this.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    const write = (list: string[]) => this.setAttribute("class", [...new Set(list)].join(" "));
    this.classList = {
      add: (...items) => write([...names(), ...items]),
      remove: (...items) => write(names().filter(name => !items.includes(name))),
      contains: name => names().includes(name),
      toggle: (name, force) => { const next = force ?? !names().includes(name); if (next) write([...names(), name]); else write(names().filter(item => item !== name)); return next; },
    };
  }

  get localName(): string { return this.tagName.toLowerCase(); }
  getAttribute(name: string): string | null { return this.attributes.get(name.toLowerCase()) ?? null; }
  setAttribute(name: string, value: string): void { this.attributes.set(name.toLowerCase(), String(value)); }
  removeAttribute(name: string): void { this.attributes.delete(name.toLowerCase()); }
  hasAttribute(name: string): boolean { return this.attributes.has(name.toLowerCase()); }
  toggleAttribute(name: string, force?: boolean): boolean {
    const next = force ?? !this.hasAttribute(name);
    if (next) this.setAttribute(name, ""); else this.removeAttribute(name);
    return next;
  }
  private flag(name: string, value: boolean): void { if (value) this.setAttribute(name, ""); else this.removeAttribute(name); }
  get id(): string { return this.getAttribute("id") ?? ""; }
  set id(value: string) { this.setAttribute("id", value); }
  get className(): string { return this.getAttribute("class") ?? ""; }
  set className(value: string) { this.setAttribute("class", value); }
  get hidden(): boolean { return this.hasAttribute("hidden"); }
  set hidden(value: boolean) { this.flag("hidden", value); }
  get disabled(): boolean { return this.hasAttribute("disabled"); }
  set disabled(value: boolean) { this.flag("disabled", value); }
  get type(): string { return this.getAttribute("type") ?? (this.tagName === "BUTTON" ? "submit" : this.tagName === "INPUT" ? "text" : ""); }
  set type(value: string) { this.setAttribute("type", value); }
  get tabIndex(): number { const value = this.getAttribute("tabindex"); return value === null ? (["BUTTON", "INPUT", "SELECT"].includes(this.tagName) ? 0 : -1) : Number(value); }
  set tabIndex(value: number) { this.setAttribute("tabindex", String(value)); }
  get placeholder(): string { return this.getAttribute("placeholder") ?? ""; }
  set placeholder(value: string) { this.setAttribute("placeholder", value); }
  get min(): string { return this.getAttribute("min") ?? ""; }
  set min(value: string) { this.setAttribute("min", value); }
  get max(): string { return this.getAttribute("max") ?? ""; }
  set max(value: string) { this.setAttribute("max", value); }
  get step(): string { return this.getAttribute("step") ?? ""; }
  set step(value: string) { this.setAttribute("step", value); }
  get isContentEditable(): boolean { return false; }
  get options(): FakeElement[] { return this.querySelectorAll("option"); }
  get selected(): boolean { return this.selectedState; }
  set selected(value: boolean) { this.selectedState = value; }
  get value(): string {
    if (this.tagName === "SELECT") { const options = this.options; return (options.find(option => option.selected) ?? options[0])?.value ?? ""; }
    if (this.tagName === "OPTION") return this.getAttribute("value") ?? this.textContent;
    return this.valueState ?? this.getAttribute("value") ?? "";
  }
  set value(value: string) {
    if (this.tagName === "SELECT") { for (const option of this.options) option.selected = option.value === value; return; }
    if (this.tagName === "OPTION") { this.setAttribute("value", value); return; }
    this.valueState = String(value);
  }
  set innerHTML(markup: string) { this.replaceChildren(); parseMarkup(markup, this, this.ownerDocument!); }
  get innerHTML(): string { return ""; }
  matches(selector: string): boolean { return parseSelectorList(selector).some(item => matchesComplex(this, item, null)); }
  closest(selector: string): FakeElement | null {
    const selectors = parseSelectorList(selector);
    for (let node: FakeElement | null = this; node; node = node.parentElement) if (selectors.some(item => matchesComplex(node!, item, null))) return node;
    return null;
  }
  get nextElementSibling(): FakeElement | null { const siblings = this.parentNode?.children ?? []; return siblings[siblings.indexOf(this) + 1] ?? null; }
  get previousElementSibling(): FakeElement | null { const siblings = this.parentNode?.children ?? []; return siblings[siblings.indexOf(this) - 1] ?? null; }
  getBoundingClientRect(): DOMRect {
    const { left, top, width, height } = this.rect;
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
  }
  focus(): void { this.ownerDocument?.focusElement(this); }
  blur(): void { if (this.ownerDocument?.activeElement === this) this.ownerDocument.focusElement(this.ownerDocument.body); }
  click(): void { if (!this.disabled) this.dispatchEvent(new FakeEvent("click")); }
  setPointerCapture(): void { /* no-op */ }
  releasePointerCapture(): void { /* no-op */ }
  scrollIntoView(): void { /* no-op */ }
}

export class FakeDocument extends FakeNode {
  readonly documentElement: FakeElement;
  readonly head: FakeElement;
  readonly body: FakeElement;
  activeElement: FakeElement;
  defaultView: FakeWindow | null = null;
  constructor() {
    super(9, null);
    this.documentElement = new FakeElement("html", this); this.head = new FakeElement("head", this); this.body = new FakeElement("body", this);
    this.documentElement.append(this.head, this.body); this.append(this.documentElement);
    this.activeElement = this.body;
  }
  createElement(tag: string): FakeElement { return new FakeElement(tag, this); }
  createTextNode(text: string): FakeText { return new FakeText(text, this); }
  focusElement(element: FakeElement): void {
    const previous = this.activeElement;
    if (previous === element) return;
    this.activeElement = element;
    previous.dispatchEvent(new FakeEvent("focusout", { relatedTarget: element }));
    element.dispatchEvent(new FakeEvent("focusin", { relatedTarget: previous }));
  }
}

export class FakeWindow extends FakeEventTarget {
  innerWidth = 1280; innerHeight = 800;
  resizeEvents = 0;
  matchMedia: ((query: string) => unknown) | undefined;
  constructor(readonly document: FakeDocument) { super(); }
  getComputedStyle(): Record<string, string> { return { position: "static", visibility: "visible", opacity: "1", paddingBottom: "0px" }; }
  override dispatchEvent(event: FakeEvent | Event): boolean { if (event.type === "resize") this.resizeEvents++; return super.dispatchEvent(event); }
}

// ---------------------------------------------------------------- selectors
interface Compound { tag: string | null; id: string | null; classes: string[]; attributes: { name: string; value: string | null }[] }
interface Complex { parts: { compound: Compound; combinator: " " | ">" | null }[] }

function parseCompound(text: string): Compound {
  const compound: Compound = { tag: null, id: null, classes: [], attributes: [] };
  const pattern = /^([a-zA-Z*][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/g;
  let match: RegExpExecArray | null, consumed = 0;
  while ((match = pattern.exec(text))) {
    if (match.index !== consumed) throw new Error(`Unsupported selector: ${text}`);
    consumed = pattern.lastIndex;
    if (match[1]) compound.tag = match[1] === "*" ? null : match[1].toUpperCase();
    else if (match[2]) compound.id = match[2];
    else if (match[3]) compound.classes.push(match[3]);
    else if (match[4]) compound.attributes.push({ name: match[4].toLowerCase(), value: match[5] ?? match[6] ?? match[7] ?? null });
  }
  if (consumed !== text.length) throw new Error(`Unsupported selector: ${text}`);
  return compound;
}

const selectorCache = new Map<string, Complex[]>();
function parseSelectorList(selector: string): Complex[] {
  const cached = selectorCache.get(selector);
  if (cached) return cached;
  const list: Complex[] = [];
  for (const part of selector.split(/,(?![^[]*\])/)) {
    const tokens = part.trim().replace(/\s*>\s*/g, " > ").split(/\s+(?![^[]*\])/).filter(Boolean);
    const parts: Complex["parts"] = [];
    let combinator: " " | ">" | null = null;
    for (const token of tokens) {
      if (token === ">") { combinator = ">"; continue; }
      parts.push({ compound: parseCompound(token), combinator: parts.length ? combinator ?? " " : null });
      combinator = null;
    }
    list.push({ parts });
  }
  selectorCache.set(selector, list);
  return list;
}

function matchesCompound(element: FakeElement, compound: Compound): boolean {
  if (compound.tag && element.tagName !== compound.tag) return false;
  if (compound.id && element.id !== compound.id) return false;
  if (compound.classes.some(name => !element.classList.contains(name))) return false;
  return compound.attributes.every(({ name, value }) => value === null ? element.hasAttribute(name) : element.getAttribute(name) === value);
}

function matchesComplex(element: FakeElement, complex: Complex, scope: FakeNode | null): boolean {
  const match = (node: FakeElement, index: number): boolean => {
    const part = complex.parts[index]!;
    if (!matchesCompound(node, part.compound)) return false;
    if (index === 0) return true;
    const within = (candidate: FakeNode | null) => candidate instanceof FakeElement && (!scope || scope.contains(candidate));
    if (part.combinator === ">") return within(node.parentNode) && match(node.parentNode as FakeElement, index - 1);
    for (let ancestor = node.parentNode; within(ancestor); ancestor = ancestor!.parentNode) if (match(ancestor as FakeElement, index - 1)) return true;
    return false;
  };
  return match(element, complex.parts.length - 1);
}

// ------------------------------------------------------------------ markup
const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const decode = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|#39|nbsp);/gi, (_, entity: string) => {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", nbsp: " " };
  if (named[entity.toLowerCase()]) return named[entity.toLowerCase()]!;
  return String.fromCodePoint(entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
});

function parseMarkup(markup: string, parent: FakeElement, document: FakeDocument): void {
  const stack: FakeNode[] = [parent];
  let index = 0;
  while (index < markup.length) {
    const top = stack.at(-1)!;
    if (markup.startsWith("<!--", index)) { const end = markup.indexOf("-->", index); index = end < 0 ? markup.length : end + 3; continue; }
    if (markup[index] === "<" && markup[index + 1] === "/") {
      const end = markup.indexOf(">", index), name = markup.slice(index + 2, end).trim().toUpperCase();
      for (let depth = stack.length - 1; depth > 0; depth--) if ((stack[depth] as FakeElement).tagName === name) { stack.length = depth; break; }
      index = end + 1; continue;
    }
    if (markup[index] === "<" && /[a-zA-Z]/.test(markup[index + 1] ?? "")) {
      let end = index + 1, quote: string | null = null;
      for (; end < markup.length; end++) {
        const character = markup[end];
        if (quote) { if (character === quote) quote = null; continue; }
        if (character === "\"" || character === "'") quote = character;
        else if (character === ">") break;
      }
      const source = markup.slice(index + 1, end), selfClosing = source.endsWith("/");
      const nameMatch = /^[a-zA-Z][\w-]*/.exec(source)!, element = document.createElement(nameMatch[0]);
      const attributePattern = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
      attributePattern.lastIndex = nameMatch[0].length;
      let attribute: RegExpExecArray | null;
      while ((attribute = attributePattern.exec(source))) element.setAttribute(attribute[1]!, decode(attribute[2] ?? attribute[3] ?? attribute[4] ?? ""));
      top.append(element);
      if (!selfClosing && !voidTags.has(element.localName)) stack.push(element);
      index = end + 1; continue;
    }
    const next = markup.indexOf("<", index + 1), end = next < 0 ? markup.length : next;
    top.append(decode(markup.slice(index, end)));
    index = end;
  }
}

// ----------------------------------------------------------------- install
export interface MiniDom { document: FakeDocument; window: FakeWindow; restore(): void }

export function installMiniDom(): MiniDom {
  const document = new FakeDocument(), window = new FakeWindow(document);
  document.defaultView = window;
  const buttonClass = { [Symbol.hasInstance]: (value: unknown) => value instanceof FakeElement && value.tagName === "BUTTON" };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("Node", FakeNode);
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("HTMLButtonElement", buttonClass);
  return { document, window, restore: () => vi.unstubAllGlobals() };
}

/** Media query lists whose matches can be flipped by tests. */
export function fakeMedia(initial: Partial<Record<"narrow" | "coarse" | "shortLandscape", boolean>> = {}) {
  const lists = new Map<string, FakeEventTarget & { matches: boolean; media: string }>();
  const keyFor = (query: string) => query.includes("pointer") ? "coarse" : query.includes("orientation") ? "shortLandscape" : "narrow";
  const matchMedia = (query: string) => {
    const list = Object.assign(new FakeEventTarget(), { matches: initial[keyFor(query)] ?? false, media: query });
    lists.set(keyFor(query), list);
    return list as unknown as MediaQueryList;
  };
  const set = (key: "narrow" | "coarse" | "shortLandscape", matches: boolean) => {
    const list = lists.get(key);
    if (!list) return;
    list.matches = matches;
    list.dispatchEvent(new FakeEvent("change"));
  };
  return { matchMedia, set };
}

export function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

export function throwingStorage() {
  const error = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
  return { getItem: vi.fn(error), setItem: vi.fn(error) };
}

export function fire(target: FakeNode, type: string, init: Partial<FakeEvent> = {}): FakeEvent {
  const event = new FakeEvent(type, init);
  target.dispatchEvent(event);
  return event;
}
