import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { LocomotionMode } from "../world/worldTypes";

export interface NativeLocomotionSpeeds {
  readonly walkMetresPerSecond: number;
  readonly runMetresPerSecond: number;
  readonly runStartSeconds: number;
  readonly isSourced: boolean;
}

export interface NativeLocomotionControlTarget extends Pick<GameWorldAdapter, "dispatch" | "subscribe"> {
  readonly locomotionMode: LocomotionMode;
  readonly speedProfile: NativeLocomotionSpeeds;
}

export function attachNativeLocomotionControls(host: HTMLElement, controlTarget: NativeLocomotionControlTarget, walkAvailable: boolean, reason: string | null) {
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
    button.addEventListener("click", () => { controlTarget.dispatch({ type: "set-locomotion", mode: value }); update(); }, { signal: lifetime.signal });
    group.append(button); buttons.set(value, button);
  }
  const speed = document.createElement("output");
  speed.className = "dev-readout"; speed.dataset.testid = "native-locomotion-speed";
  const update = () => {
    const mode = controlTarget.locomotionMode, profile = controlTarget.speedProfile;
    for (const [value, button] of buttons) button.setAttribute("aria-checked", String(value === mode));
    const gaitSpeedText = mode === "walk" ? `${profile.walkMetresPerSecond.toFixed(2)} m/s` :
      `${profile.runMetresPerSecond.toFixed(2)} m/s (walk speed for the first ${profile.runStartSeconds} s)`;
    speed.textContent = profile.isSourced ? gaitSpeedText : `${gaitSpeedText}, speed unresolved`;
  };
  update();
  const unsubscribe = controlTarget.subscribe(update);
  root.append(label, group, speed);
  if (reason) { const note = document.createElement("p"); note.className = "dev-note"; note.textContent = reason; root.append(note); }
  host.append(root);
  return { update, dispose() { lifetime.abort(); unsubscribe(); root.remove(); } };
}
