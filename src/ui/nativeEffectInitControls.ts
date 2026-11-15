import type { NativeEffectInitPreview } from "../effects/nativeEffectInitPreview";

export function attachNativeEffectInitControls(host: HTMLElement, preview: NativeEffectInitPreview | null,
  beforeEnable: () => Promise<void>, inspect: () => void) {
  const root = document.createElement("div"), events = new AbortController();
  root.dataset.testid = "native-init-effect-controls";
  const label = document.createElement("label"), enabled = document.createElement("input");
  enabled.type = "checkbox"; enabled.dataset.testid = "native-init-effect-enabled";
  enabled.disabled = preview === null; label.append(enabled, " Power Strike init preview");
  const frame = document.createElement("button"); frame.type = "button"; frame.textContent = "Inspect init effects";
  frame.dataset.testid = "native-init-effect-inspect";
  const status = document.createElement("p"); status.dataset.testid = "native-init-effect-status"; status.setAttribute("role", "status");
  root.append(label, frame, status); host.append(root);
  let request = 0;
  const update = () => {
    const state = preview?.snapshot();
    enabled.checked = state?.enabled ?? false;
    frame.disabled = state?.status !== "playing";
    status.textContent = !preview ? "Original init effects are unavailable for this character." :
      state?.status === "loading" ? "Preparing original init components…" :
      state?.status === "failed" ? `Init preview unavailable: ${state.error}` :
      state?.status === "playing" ? "Showing source-informed init particles with the original action clock." :
      state?.enabled ? "Ready. Use Special attack preview. Authored timings and deterministic particle choices are a browser preview; full skill playback remains pending." :
      "Enable to add timed original init components to the next Special attack preview. No additional sounds are selected.";
  };
  enabled.addEventListener("change", () => {
    const value = enabled.checked, token = ++request;
    if (!value) { void preview?.setEnabled(false); return; }
    void beforeEnable().then(() => { if (!events.signal.aborted && token === request) return preview?.setEnabled(true); });
  }, { signal: events.signal });
  frame.addEventListener("click", inspect, { signal: events.signal });
  const unsubscribe = preview?.subscribe(update); update();
  return { dispose() { request++; events.abort(); unsubscribe?.(); root.remove(); } };
}
