export class MinimalFakeDomElement {
  children: (MinimalFakeDomElement | string)[] = [];
  parent: MinimalFakeDomElement | null = null;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  className = ""; type = ""; value = ""; min = ""; max = ""; step = ""; id = ""; disabled = false; tabIndex = 0;
  private text = "";
  private listeners = new Map<string, ((event: unknown) => void)[]>();
  constructor(readonly tagName: string) {}
  get textContent(): string { return this.text + this.children.map(child => typeof child === "string" ? child : child.textContent).join(""); }
  set textContent(value: string) { this.text = value; this.children = []; }
  get isConnected(): boolean { return true; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  append(...nodes: (MinimalFakeDomElement | string)[]): void { for (const node of nodes) { if (typeof node !== "string") node.parent = this; this.children.push(node); } }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  addEventListener(type: string, listener: (event: unknown) => void, options?: { signal?: AbortSignal }): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    options?.signal?.addEventListener("abort", () => this.listeners.set(type, []));
  }
  dispatch(type: string, event: unknown = { type }): void { for (const listener of this.listeners.get(type) ?? []) listener(event); }
  click(): void { this.dispatch("click"); }
  focus(): void {}
  getClientRects(): unknown[] { return [1]; }
  all(): MinimalFakeDomElement[] { return this.children.flatMap(child => typeof child === "string" ? [] : [child, ...child.all()]); }
  byTestId(id: string): MinimalFakeDomElement { return this.all().find(element => element.dataset.testid === id)!; }
}

export const minimalFakeDocument = { createElement: (tag: string) => new MinimalFakeDomElement(tag.toUpperCase()) };
