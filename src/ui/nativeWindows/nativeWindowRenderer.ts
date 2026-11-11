import type { WorldEntity } from "../../world/worldTypes";
import { resolveNativeWindowRectangles, type NativeWindowRectangle, type NativeWindowScreen } from "./nativeWindowAnchors";
import type { NativeWindowFieldBinding } from "./nativeWindowFieldBindings";
import type { NativeWindowManifest, NativeWindowNode } from "./nativeWindowLayoutTree";
import type { NativeWindowMinimapTileSource, NativeWindowTextureResolution } from "./nativeWindowManifestLoader";
import { minimapControlType, renderMinimapControl, type RenderedMinimapControl } from "./minimapControl";
import { placeNativeWindowElement } from "./nativeWindowPlacement";

export const nativeWindowRenderedControlTypes: readonly string[] = ["Window", "Texture", "Button", "TextBox", minimapControlType];

export interface NativeWindowRenderInputs {
  readonly localPlayer: WorldEntity | null;
  readonly textures: ReadonlyMap<string, NativeWindowTextureResolution>;
  readonly fieldBindings: readonly NativeWindowFieldBinding[];
  readonly screen: NativeWindowScreen;
  readonly minimapTileSource: NativeWindowMinimapTileSource;
}

export interface NativeWindowControlGap { readonly controlName: string; readonly reason: string }

export interface RenderedNativeWindow {
  readonly element: HTMLElement;
  readonly gaps: readonly NativeWindowControlGap[];
  refresh(localPlayer: WorldEntity | null): void;
  dispose(): void;
}

const labelUnresolvedReason = "label-unresolved";
const textureNotInCatalogReason = "texture-not-in-catalog";
const textBoxControlType = "TextBox";
const controlTypeUnsupportedPrefix = "control-type-unsupported:";
const adapterFieldAbsentPrefix = "adapter-field-absent:";
const bindingControlMissingPrefix = "binding-control-missing:";
const bindingControlAmbiguousPrefix = "binding-control-ambiguous:";

interface RenderedControl {
  readonly node: NativeWindowNode;
  readonly element: HTMLElement;
  readonly rectangle: NativeWindowRectangle;
  readonly staticGaps: readonly string[];
  readonly gauge: RenderedGauge | null;
  readonly minimap: RenderedMinimapControl | null;
}

interface RenderedGauge {
  readonly binding: NativeWindowFieldBinding;
  readonly fillElement: HTMLElement;
  readonly fillImage: HTMLImageElement | null;
  liveGap: string | null;
}

function textureImage(url: string, width: number, height: number): HTMLImageElement {
  const image = document.createElement("img");
  image.setAttribute("alt", "");
  image.setAttribute("src", url);
  placeNativeWindowElement(image, 0, 0, width, height);
  return image;
}

function firstTextureGapOrImage(node: NativeWindowNode, rectangle: NativeWindowRectangle,
  textures: ReadonlyMap<string, NativeWindowTextureResolution>): { readonly image: HTMLImageElement | null; readonly gap: string | null } {
  const firstReference = node.textures[0];
  if (firstReference === undefined) return { image: null, gap: null };
  const resolution: NativeWindowTextureResolution = textures.get(firstReference) ??{ status: "gap", reason: textureNotInCatalogReason };
  if (resolution.status === "gap") return { image: null, gap: resolution.reason };
  return { image: textureImage(resolution.url, rectangle.width, rectangle.height), gap: null };
}

function uniqueBindingNodes(root: NativeWindowNode, bindings: readonly NativeWindowFieldBinding[]): {
  readonly bindingByNode: ReadonlyMap<NativeWindowNode, NativeWindowFieldBinding>; readonly unplacedBindingGaps: readonly string[] } {
  const nodesByName = new Map<string, NativeWindowNode[]>();
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    nodesByName.set(node.name, [...(nodesByName.get(node.name) ?? []), node]);
    pending.push(...node.children);
  }
  const bindingByNode = new Map<NativeWindowNode, NativeWindowFieldBinding>();
  const unplacedBindingGaps: string[] = [];
  for (const binding of bindings) {
    const candidates = nodesByName.get(binding.controlName) ?? [];
    if (candidates.length === 1) bindingByNode.set(candidates[0]!, binding);
    else unplacedBindingGaps.push((candidates.length === 0 ? bindingControlMissingPrefix : bindingControlAmbiguousPrefix) + binding.controlName);
  }
  return { bindingByNode, unplacedBindingGaps };
}

function gaugeFor(binding: NativeWindowFieldBinding, rectangle: NativeWindowRectangle,
  textures: ReadonlyMap<string, NativeWindowTextureResolution>): { readonly gauge: RenderedGauge | null; readonly gaps: readonly string[] } {
  if (binding.gapReason !== null) return { gauge: null, gaps: [binding.gapReason] };
  const fillElement = document.createElement("div");
  fillElement.setAttribute("data-native-gauge-fill", binding.worldField ?? "");
  placeNativeWindowElement(fillElement, 0, 0, 0, rectangle.height);
  const fillTexture = binding.fillTextureRef === null ? undefined : textures.get(binding.fillTextureRef);
  const fillImage = fillTexture?.status === "resolved" ? textureImage(fillTexture.url, 0, rectangle.height) : null;
  if (fillImage !== null) fillElement.append(fillImage);
  const fillGap = binding.fillTextureRef !== null && fillTexture?.status !== "resolved" ? [fillTexture?.status === "gap" ? fillTexture.reason : textureNotInCatalogReason] : [];
  return { gauge: { binding, fillElement, fillImage, liveGap: null }, gaps: fillGap };
}

function staticControlGaps(node: NativeWindowNode, anchorGaps: readonly string[]): string[] {
  const gaps = [...anchorGaps];
  if (!nativeWindowRenderedControlTypes.includes(node.type)) gaps.push(controlTypeUnsupportedPrefix + node.type);
  if (node.type === textBoxControlType) gaps.push(labelUnresolvedReason);
  return gaps;
}

function refreshGauge(control: RenderedControl, gauge: RenderedGauge, localPlayer: WorldEntity | null): void {
  const worldField = gauge.binding.worldField!;
  if (localPlayer === null) {
    gauge.liveGap = adapterFieldAbsentPrefix + worldField;
    gauge.fillElement.remove();
    return;
  }
  gauge.liveGap = null;
  const maximum = localPlayer[gauge.binding.maximumField!];
  const fillWidth = maximum > 0 ? Math.trunc(control.rectangle.width * localPlayer[worldField] / maximum) : 0;
  gauge.fillElement.style.width = `${fillWidth}px`;
  if (gauge.fillImage !== null) gauge.fillImage.style.width = `${fillWidth}px`;
  if (gauge.fillElement.parentNode !== control.element) control.element.append(gauge.fillElement);
}

function controlGapReasons(control: RenderedControl): readonly string[] {
  return [...new Set([...control.staticGaps, ...(control.gauge?.liveGap ? [control.gauge.liveGap] : [])])];
}

function markControlGaps(control: RenderedControl): void {
  const reasons = controlGapReasons(control);
  if (reasons.length === 0) control.element.removeAttribute("data-native-gap");
  else control.element.setAttribute("data-native-gap", reasons.join(" "));
}

export function renderNativeWindow(container: HTMLElement, windowManifest: NativeWindowManifest, renderInputs: NativeWindowRenderInputs): RenderedNativeWindow {
  const { rectangles, gaps: anchorGaps } = resolveNativeWindowRectangles(windowManifest.root, renderInputs.screen);
  const { bindingByNode, unplacedBindingGaps } = uniqueBindingNodes(windowManifest.root,
    renderInputs.fieldBindings.filter(binding => binding.windowId === windowManifest.windowId));
  const controls: RenderedControl[] = [];
  const renderNode = (node: NativeWindowNode, parentRectangle: NativeWindowRectangle | null): HTMLElement => {
    const rectangle = rectangles.get(node)!;
    const element = document.createElement("div");
    element.setAttribute("data-native-control", node.name);
    element.setAttribute("data-native-type", node.type);
    placeNativeWindowElement(element, rectangle.left - (parentRectangle?.left ?? 0), rectangle.top - (parentRectangle?.top ?? 0), rectangle.width, rectangle.height);
    const texture = firstTextureGapOrImage(node, rectangle, renderInputs.textures);
    if (texture.image !== null) element.append(texture.image);
    const binding = bindingByNode.get(node);
    const bound = binding === undefined ? { gauge: null, gaps: [] } : gaugeFor(binding, rectangle, renderInputs.textures);
    const nodeAnchorGaps = anchorGaps.filter(gap => gap.node === node).map(gap => gap.reason);
    const staticGaps = [...staticControlGaps(node, nodeAnchorGaps), ...(texture.gap === null ? [] : [texture.gap]), ...bound.gaps,
      ...(node === windowManifest.root ? unplacedBindingGaps : [])];
    const minimap = node.type === minimapControlType
      ? renderMinimapControl(element, rectangle, { localPlayer: renderInputs.localPlayer, tileSource: renderInputs.minimapTileSource }) : null;
    controls.push({ node, element, rectangle, staticGaps, gauge: bound.gauge, minimap });
    node.children.forEach(child => element.append(renderNode(child, rectangle)));
    return element;
  };
  const element = renderNode(windowManifest.root, null);
  element.setAttribute("data-native-window", windowManifest.windowId);
  const refresh = (localPlayer: WorldEntity | null): void => {
    for (const control of controls) {
      if (control.gauge !== null) refreshGauge(control, control.gauge, localPlayer);
      control.minimap?.refresh(localPlayer);
      markControlGaps(control);
    }
  };
  refresh(renderInputs.localPlayer);
  container.append(element);
  return {
    element,
    get gaps() { return controls.flatMap(control => controlGapReasons(control).map(reason => ({ controlName: control.node.name, reason }))); },
    refresh,
    dispose: () => {
      controls.forEach(control => control.minimap?.dispose());
      element.remove();
    },
  };
}
