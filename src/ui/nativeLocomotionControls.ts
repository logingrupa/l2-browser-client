import type { LocomotionMode } from "../world/worldTypes";
import type { NativeSliceAdapter } from "../world/NativeSliceAdapter";

/** Walk/Run as a chip radiogroup showing the armed gait (the HUD marks its own
 * Run/Walk actions). Speeds come from the adapter's speed profile. */
export function attachNativeLocomotionControls(host: HTMLElement, adapter: NativeSliceAdapter, walkAvailable: boolean, reason: string | null) {
  const root = document.createElement("div"), lifetime = new AbortController();
  root.dataset.testid = "native-locomotion-controls";
  const label = document.createElement("span"), group = document.createElement("div");
  label.className = "dev-row-label"; label.textContent = "Gait";
  group.className = "dev-chips"; group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", "Movement gait");
  const buttons = new Map<LocomotionMode, HTMLButtonElement>();
  for (const [value, title] of [["walk", "Walk"], ["run", "Run"]] as const) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "dev-chip"; button.setAttribute("role", "radio"); button.dataset.value = value;
    button.dataset.testid = `native-locomotion-${value}`; button.textContent = title;
    button.disabled = value === "walk" && !walkAvailable;
    button.addEventListener("click", () => { adapter.dispatch({ type: "set-locomotion", mode: value }); update(); }, { signal: lifetime.signal });
    group.append(button); buttons.set(value, button);
  }
  const speed = document.createElement("output");
  speed.className = "dev-readout"; speed.dataset.testid = "native-locomotion-speed";
  const update = () => {
    const mode = adapter.locomotionMode, profile = adapter.speedProfile;
    for (const [value, button] of buttons) button.setAttribute("aria-checked", String(value === mode));
    speed.textContent = mode === "walk" ? `${profile.walkMetresPerSecond.toFixed(2)} m/s` :
      `${profile.runMetresPerSecond.toFixed(2)} m/s (walk speed for the first ${profile.runStartSeconds} s)`;
  };
  update();
  const unsubscribe = adapter.subscribe(update);
  root.append(label, group, speed);
  if (reason) { const note = document.createElement("p"); note.className = "dev-note"; note.textContent = reason; root.append(note); }
  host.append(root);
  return { update, dispose() { lifetime.abort(); unsubscribe(); root.remove(); } };
}
