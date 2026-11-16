import uiFontRecipeText from "../../../recipes/data/ui-fonts.json?raw";
import type { NativeWindowRectangle } from "./nativeWindowAnchors";
import { layoutNativeWindowText, type NativeWindowFont, type NativeWindowFontAtlasPixels, type NativeWindowGlyph, type NativeWindowPlacedGlyph,
  type NativeWindowTextLayout } from "./nativeWindowFonts";
import type { NativeWindowNode } from "./nativeWindowLayoutTree";
import { placeNativeWindowElement } from "./nativeWindowPlacement";

export type NativeWindowFontRoute = "bitmap-glyph-table" | "digit-atlas" | "system-face";

export type TextBoxTextPlan =
  | { readonly status: "drawn"; readonly font: NativeWindowFont; readonly layout: NativeWindowTextLayout; readonly color: string; readonly gaps: readonly string[] }
  | { readonly status: "gap"; readonly gaps: readonly string[] };

export interface RenderedTextBox {
  readonly gaps: readonly string[];
  place(rectangle: NativeWindowRectangle): void;
  showText(text: string): void;
}

export const textBoxTextSetAtRuntimeReason = "textbox-text-set-at-runtime";
export const textBoxTextUndefinedSentinelReason = "textbox-text-undefined-sentinel";
export const textBoxTailUnresolvedReason = "textbox-tail-unresolved";
export const textBoxColourUnresolvedReason = "textbox-colour-unresolved";
export const fontBitmapBranchUnconfirmedReason = "font-bitmap-branch-unconfirmed";
export const uiFontUnresolvedPrefix = "ui-font-unresolved:";
export const fontGdiFaceUnconvertedPrefix = "font-gdi-face-unconverted:";
const undefinedTextSentinel = "undefined";
const textPlacementPresentation = "left, centre or right inside the control width by its decoded align, from the left without one; presentation";
const glyphColourPresentation = "atlas texel channels times the decoded colour channels over 255, atlas alpha kept; presentation";
const channelMaximum = 255;
const rgbaChannels = 4;
const fontRoutes: readonly NativeWindowFontRoute[] = ["bitmap-glyph-table", "digit-atlas", "system-face"];

function readFontRoutes(recipeText: string): ReadonlyMap<number, NativeWindowFontRoute> {
  const recipe = JSON.parse(recipeText) as { fonts?: unknown };
  if (!Array.isArray(recipe.fonts)) throw new Error("recipes/data/ui-fonts.json has no fonts list.");
  return new Map(recipe.fonts.map((entry: unknown) => {
    const { fontType, route } = entry as { fontType?: unknown; route?: unknown };
    if (typeof fontType !== "number" || !Number.isSafeInteger(fontType) || !fontRoutes.includes(route as NativeWindowFontRoute)) {
      throw new Error("recipes/data/ui-fonts.json lists a font without an integer fontType and a known route.");
    }
    return [fontType, route as NativeWindowFontRoute];
  }));
}

export const nativeWindowFontRoutes: ReadonlyMap<number, NativeWindowFontRoute> = readFontRoutes(uiFontRecipeText);

function textGapReason(text: string): string | null {
  if (text === "") return textBoxTextSetAtRuntimeReason;
  if (text === undefinedTextSentinel) return textBoxTextUndefinedSentinelReason;
  return null;
}

export function planTextBoxText(node: NativeWindowNode, text: string | null, fonts: ReadonlyMap<number, NativeWindowFont>,
  routes: ReadonlyMap<number, NativeWindowFontRoute> = nativeWindowFontRoutes): TextBoxTextPlan {
  if (node.textLayout === undefined) return { status: "gap", gaps: [textBoxTailUnresolvedReason] };
  const shownText = text ?? node.textLayout.defaultText;
  const textGap = textGapReason(shownText);
  if (textGap !== null) return { status: "gap", gaps: [textGap] };
  const fontType = node.textLayout.fontType;
  const route = routes.get(fontType);
  if (route === "system-face") return { status: "gap", gaps: [fontGdiFaceUnconvertedPrefix + fontType] };
  const font = fonts.get(fontType);
  if (route === undefined || font === undefined) return { status: "gap", gaps: [uiFontUnresolvedPrefix + fontType] };
  if (node.color === undefined) return { status: "gap", gaps: [textBoxColourUnresolvedReason] };
  return { status: "drawn", font, layout: layoutNativeWindowText(font.manifest, shownText), color: node.color,
    gaps: route === "bitmap-glyph-table" ? [fontBitmapBranchUnconfirmedReason] : [] };
}

function textLeft(node: NativeWindowNode, controlWidth: number, textWidth: number): number {
  if (node.align === "center") return Math.trunc((controlWidth - textWidth) / 2);
  if (node.align === "right") return controlWidth - textWidth;
  return 0;
}

export interface DecodedColourChannels { readonly red: number; readonly green: number; readonly blue: number }

export function decodedColourChannels(decodedColour: string): DecodedColourChannels {
  const channel = (start: number): number => Number.parseInt(decodedColour.slice(start, start + 2), 16);
  return { red: channel(1), green: channel(3), blue: channel(5) };
}

export function tintedGlyphPixels(atlas: NativeWindowFontAtlasPixels, glyph: NativeWindowGlyph, colour: DecodedColourChannels): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(glyph.width * glyph.height * rgbaChannels);
  for (let row = 0; row < glyph.height; row += 1) {
    for (let column = 0; column < glyph.width; column += 1) {
      const source = ((glyph.y + row) * atlas.width + glyph.x + column) * rgbaChannels;
      const target = (row * glyph.width + column) * rgbaChannels;
      pixels[target] = atlas.rgba[source]! * colour.red / channelMaximum;
      pixels[target + 1] = atlas.rgba[source + 1]! * colour.green / channelMaximum;
      pixels[target + 2] = atlas.rgba[source + 2]! * colour.blue / channelMaximum;
      pixels[target + 3] = atlas.rgba[source + 3]!;
    }
  }
  return pixels;
}

function glyphCanvas(font: NativeWindowFont, colour: DecodedColourChannels, placed: NativeWindowPlacedGlyph): HTMLCanvasElement {
  const { glyph } = placed;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("data-native-glyph", "");
  canvas.width = glyph.width;
  canvas.height = glyph.height;
  placeNativeWindowElement(canvas, placed.left, 0, glyph.width, glyph.height);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("A native TextBox glyph needs a 2D canvas context.");
  const image = context.createImageData(glyph.width, glyph.height);
  image.data.set(tintedGlyphPixels(font.atlasPixels, glyph, colour));
  context.putImageData(image, 0, 0);
  return canvas;
}

export function renderTextBox(controlElement: HTMLElement, node: NativeWindowNode, fonts: ReadonlyMap<number, NativeWindowFont>): RenderedTextBox {
  const textElement = document.createElement("div");
  textElement.setAttribute("data-native-text-placement", textPlacementPresentation);
  textElement.setAttribute("data-native-glyph-colour", glyphColourPresentation);
  let plan = planTextBoxText(node, null, fonts);
  let rectangle: NativeWindowRectangle | null = null;
  const draw = (): void => {
    textElement.replaceChildren();
    if (plan.status === "gap") {
      textElement.remove();
      textElement.removeAttribute("data-native-text");
      return;
    }
    const drawn = plan;
    const colour = decodedColourChannels(drawn.color);
    textElement.setAttribute("data-native-text", drawn.layout.glyphs.length === 0 ? "" : "drawn");
    textElement.append(...drawn.layout.glyphs.map(placed => glyphCanvas(drawn.font, colour, placed)));
    if (rectangle !== null) {
      placeNativeWindowElement(textElement, textLeft(node, rectangle.width, drawn.layout.width), 0, drawn.layout.width, drawn.layout.height);
    }
    if (textElement.parentNode !== controlElement) controlElement.append(textElement);
  };
  draw();
  return {
    get gaps() { return plan.gaps; },
    place: nextRectangle => {
      rectangle = nextRectangle;
      draw();
    },
    showText: text => {
      plan = planTextBoxText(node, text, fonts);
      draw();
    },
  };
}
