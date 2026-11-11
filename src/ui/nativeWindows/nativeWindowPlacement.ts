export function placeNativeWindowElement(element: HTMLElement, left: number, top: number, width: number, height: number): void {
  element.style.position = "absolute";
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
}
