import type { DevIconName } from "./types";

/** 24px stroke icons (currentColor). Trusted static markup only. */
const paths: Record<DevIconName | "sheet" | "pin" | "pinned" | "close" | "search" | "chevron" | "grip", string> = {
  sheet: '<path d="M4 6h10M4 12h6M4 18h10"/><circle cx="17" cy="6" r="2"/><circle cx="13" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  general: '<path d="M5 5h14v14H5z"/><path d="M9 9h6M9 12h6M9 15h3"/>',
  audio: '<path d="M4 10v4h4l5 4V6L8 10Z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
  movement: '<circle cx="15" cy="4" r="2"/><path d="m4 12 5-4 6 2 2 4h4M13 10l-3 6-5 4M10 16l6 2v4"/>',
  combat: '<path d="m7 17 11-13 2 1-1 4L8 19M5 14l5 6M3 21l4-4"/>',
  character: '<circle cx="12" cy="7" r="3.5"/><path d="M5 20c1-4 3.5-6 7-6s6 2 7 6"/>',
  world: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.4 3.5 5.2 3.5 8.5s-1 6.1-3.5 8.5c-2.5-2.4-3.5-5.2-3.5-8.5s1-6.1 3.5-8.5Z"/>',
  effects: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="m18.5 15.5.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/>',
  debug: '<path d="M8 8a4 4 0 0 1 8 0v7a4 4 0 0 1-8 0Z"/><path d="M12 11v8M4 12h4M16 12h4M5 6l3 2M19 6l-3 2M5 19l3-2M19 19l-3-2"/>',
  pin: '<path d="M14.5 3.5 20.5 9.5 17 11l-3.5 3.5.5 4-1.5 1.5-3.5-3.5L4 21l-.5-.5L8 15.5 4.5 12 6 10.5l4 .5L13.5 7.5Z"/>',
  pinned: '<path d="M14.5 3.5 20.5 9.5 17 11l-3.5 3.5.5 4-1.5 1.5-3.5-3.5L4 21l-.5-.5L8 15.5 4.5 12 6 10.5l4 .5L13.5 7.5Z" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  grip: '<path d="M8 10h8M8 14h8"/>',
};

export type DevSheetIcon = keyof typeof paths;

export function iconMarkup(name: DevSheetIcon): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

export function isDevIconName(value: unknown): value is DevIconName {
  return typeof value === "string" && value in paths && !["sheet", "pin", "pinned", "close", "search", "chevron", "grip"].includes(value);
}
