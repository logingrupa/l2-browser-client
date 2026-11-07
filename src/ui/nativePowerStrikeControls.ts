import type { NativePowerStrikePreview } from "../effects/nativePowerStrikePreview";
import type { NativeEffectShotPreview } from "../effects/nativeEffectShotPreview";

export function attachNativePowerStrikeControls(host: HTMLElement, preview: NativePowerStrikePreview | null,
  shot: NativeEffectShotPreview | null, reason: string | null, inspect: () => void) {
  const root = document.createElement("div"), events = new AbortController();
  root.dataset.testid = "native-power-strike-controls";
  const play = document.createElement("button"), stop = document.createElement("button"), frame = document.createElement("button");
  play.type = stop.type = frame.type = "button";
  play.textContent = "Power Strike at target"; play.dataset.testid = "native-power-strike-play";
  stop.textContent = "Stop skill effects"; stop.dataset.testid = "native-power-strike-stop";
  frame.textContent = "Inspect impact"; frame.dataset.testid = "native-power-strike-inspect";
  const status = document.createElement("p"); status.dataset.testid = "native-power-strike-status"; status.setAttribute("role", "status");
  const actions = document.createElement("div"); actions.className = "secondary-actions"; actions.append(play, stop, frame);
  root.append(actions, status); host.append(root);
  const update = () => {
    const action = preview?.snapshot(), effect = shot?.snapshot();
    play.disabled = !preview || action?.pending === true; stop.disabled = !preview;
    frame.disabled = effect?.status !== "playing";
    status.textContent = !preview ? reason ?? "Targeted Power Strike preview is unavailable." :
      action?.pending ? "Preparing the original charge and impact effects…" :
      action?.error ? action.error : effect?.status === "failed" ? `Impact preview unavailable: ${effect.error}` :
      effect?.status === "waiting" ? `Charging toward ${action?.targetName ?? "the target"}…` :
      effect?.status === "playing" ? "Showing the original impact components." :
      "Targets the selected Greater Musveren (or the only NPC) at any distance. No damage is applied. Hit sounds play at its AttackShot; cast/shot sounds are skillsoundgrp name-match candidates (presentation choice — native rule unverified).";
  };
  play.addEventListener("click", () => { void preview?.start(); }, { signal: events.signal });
  stop.addEventListener("click", () => preview?.stop(), { signal: events.signal });
  frame.addEventListener("click", inspect, { signal: events.signal });
  const removeAction = preview?.subscribe(update), removeEffect = shot?.subscribe(update); update();
  return { dispose() { events.abort(); removeAction?.(); removeEffect?.(); root.remove(); } };
}
