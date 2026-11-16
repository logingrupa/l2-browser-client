import uiFontRecipeText from "../../../recipes/data/ui-fonts.json?raw";
import type { NativeWindowRectangle } from "./nativeWindowAnchors";
import { layoutNativeWindowText, type NativeWindowFont, type NativeWindowTextLayout } from "./nativeWindowFonts";
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
export const fontUnresolvedPrefix = "font-unresolved:";
export const fontGdiFaceUnconvertedPrefix = "font-gdi-face-unconverted:";
const undefinedTextSentinel = "undefined";
const textPlacementPresentation = "left, centre or right inside the control width by its decoded align, from the left without one; presentation";
const glyphColourPresentation = "atlas texel times the decoded colour by CSS multiply under the atlas alpha mask; presentation";
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
  if (route === undefined || font === undefined) return { status: "gap", gaps: [fontUnresolvedPrefix + fontType] };
  if (node.color === undefined) return { status: "gap", gaps: [textBoxColourUnresolvedReason] };
  return { status: "drawn", font, layout: layoutNativeWindowText(font.manifest, shownText), color: node.color,
    gaps: route === "bitmap-glyph-table" ? [fontBitmapBranchUnconfirmedReason] : [] };
}

function textLeft(node: NativeWindowNode, controlWidth: number, textWidth: number): number {
  if (node.align === "center") return Math.trunc((controlWidth - textWidth) / 2);
  if (node.align === "right") return controlWidth - textWidth;
  return 0;
}

function glyphElement(font: NativeWindowFont, color: string, left: number, glyph: NativeWindowTextLayout["glyphs"][number]["glyph"]): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-native-glyph", "");
  placeNativeWindowElement(element, left, 0, glyph.width, glyph.height);
  const imageUrl = `url("${font.imageUrl}")`;
  const offset = `${-glyph.x}px ${-glyph.y}px`;
  element.style.backgroundImage = imageUrl;
  element.style.backgroundPosition = offset;
  element.style.backgroundRepeat = "no-repeat";
  element.style.backgroundColor = color;
  element.style.backgroundBlendMode = "multiply";
  element.style.maskImage = imageUrl;
  element.style.maskPosition = offset;
  element.style.maskRepeat = "no-repeat";
  element.style.imageRendering = "pixelated";
  return element;
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
    textElement.setAttribute("data-native-text", drawn.layout.glyphs.length === 0 ? "" : "drawn");
    textElement.append(...drawn.layout.glyphs.map(placed => glyphElement(drawn.font, drawn.color, placed.left, placed.glyph)));
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
