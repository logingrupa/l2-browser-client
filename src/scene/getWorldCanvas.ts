import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

/** Editor Play renders through a detached working canvas and displays a registered
 * view. Its public input element is the visible canvas used for CSS coordinates
 * and controls. A normal browser engine uses its rendering canvas for both. */
export function getWorldCanvas(engine: AbstractEngine): HTMLCanvasElement | null {
  const input = engine.getInputElement?.();
  return input?.tagName === "CANVAS" ? input as HTMLCanvasElement : engine.getRenderingCanvas() ?? null;
}
