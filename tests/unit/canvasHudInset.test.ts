import { expect, it } from "vitest";
import { canvasHudInset } from "../../src/ui/canvasHudInset";

function rectangle(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) };
}
function fixture(cover: DOMRect, properties: Partial<CSSStyleDeclaration> = {}) {
  const toolbar = { previousElementSibling: null, getBoundingClientRect: () => cover };
  const body = {};
  // Editor wraps the canvas in a context-menu trigger; the absolute toolbar
  // precedes that wrapper, rather than being a direct canvas sibling.
  const wrapper = { parentElement: body, previousElementSibling: toolbar };
  return {
    parentElement: wrapper, previousElementSibling: null,
    ownerDocument: { body, defaultView: { getComputedStyle: () => ({ position: "absolute", visibility: "visible", opacity: "1", ...properties }) } },
  } as unknown as HTMLCanvasElement;
}

it("reserves an actual docked toolbar height without moving canvas coordinates", () => {
  const bounds = rectangle(280, 58, 800, 382);
  expect(canvasHudInset(fixture(rectangle(280, 58, 800, 40)), bounds)).toBe(40);
  // Display scaling/toolbar resizing changes the measured reservation.
  expect(canvasHudInset(fixture(rectangle(280, 58, 800, 60)), bounds)).toBe(60);
});

it("does not reserve browser content, partial overlays, hidden bars or full loading screens", () => {
  const bounds = rectangle(0, 0, 1440, 900);
  expect(canvasHudInset(fixture(rectangle(0, 0, 1440, 40), { position: "static" }), bounds)).toBe(0);
  expect(canvasHudInset(fixture(rectangle(0, 0, 1440, 40), { opacity: "0" }), bounds)).toBe(0);
  expect(canvasHudInset(fixture(rectangle(0, 0, 1440, 40), { visibility: "hidden" }), bounds)).toBe(0);
  expect(canvasHudInset(fixture(rectangle(0, 0, 200, 40)), bounds)).toBe(0);
  expect(canvasHudInset(fixture(rectangle(0, 0, 1440, 900)), bounds)).toBe(0);
  expect(canvasHudInset(fixture(rectangle(0, -40, 1440, 40)), bounds)).toBe(0);
});

it("leaves an ordinary full-browser canvas without preceding chrome unchanged", () => {
  const canvas = fixture(rectangle(0, 0, 1440, 40));
  Object.assign(canvas.parentElement!, { previousElementSibling: null });
  expect(canvasHudInset(canvas, rectangle(0, 0, 1440, 900))).toBe(0);
});
