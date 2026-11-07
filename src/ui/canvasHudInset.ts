/** A docked preview may draw its toolbar over the canvas (Editor 5.5.3 does).
 * Reserve only the measured full-width top strip covered by a positioned
 * preceding sibling. Keep the canvas coordinate origin unchanged for labels. */
export function canvasHudInset(canvas: HTMLCanvasElement, bounds: DOMRect): number {
  const view = canvas.ownerDocument.defaultView;
  if (!view || bounds.width <= 0 || bounds.height <= 0) return 0;
  let inset = 0;
  for (let branch: Element | null = canvas; branch && branch !== canvas.ownerDocument.body; branch = branch.parentElement) {
    for (let sibling = branch.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      const style = view.getComputedStyle(sibling);
      if (!(style.position === "absolute" || style.position === "fixed") || style.visibility === "hidden" || style.opacity === "0") continue;
      const cover = sibling.getBoundingClientRect();
      if (cover.left <= bounds.left + .5 && cover.right >= bounds.right - .5 && cover.top <= bounds.top + .5 &&
        cover.bottom > bounds.top && cover.bottom < bounds.bottom) inset = Math.max(inset, cover.bottom - bounds.top);
    }
  }
  return inset;
}
