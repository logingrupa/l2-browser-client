import type { NativeEffectComponentPreview } from "../effects/nativeEffectComponentPreview";

/** Small opt-in component controls beside the existing animation preview. */
export function attachNativeEffectComponentControls(host: HTMLElement, preview: NativeEffectComponentPreview | null,
  unavailable: string | null, frameComponent: () => void) {
  const root = document.createElement("div"), lifetime = new AbortController();
  root.dataset.testid = "native-effect-controls";
  const status = document.createElement("p"); status.dataset.testid = "native-effect-status"; status.setAttribute("role", "status");
  const select = (labelText: string, id: string) => {
    const label = document.createElement("label"), control = document.createElement("select");
    label.textContent = `${labelText} `; control.setAttribute("aria-label", labelText); control.dataset.testid = id;
    label.append(control); root.append(label); return control;
  };
  const option = (value: string, text: string) => {
    const item = document.createElement("option"); item.value = value; item.textContent = text; return item;
  };
  const component = select("Power Strike component", "native-effect-component"); component.append(option("", "Off"));
  for (const row of preview?.components ?? []) component.append(option(row.object, row.object.replace(/^lineageeffect\./i, "")));
  component.disabled = preview === null;
  const frame = select("Texture frame", "native-effect-frame"), color = select("Color key", "native-effect-color-key");
  const inspect = document.createElement("button"); inspect.type = "button"; inspect.textContent = "Inspect component";
  inspect.dataset.testid = "native-effect-inspect"; root.append(inspect, status); host.append(root);
  let previousComponent: string | null | undefined;
  const update = () => {
    const state = preview?.snapshot(), selected = state?.selection.component ?? null;
    component.value = selected ?? "";
    if (selected !== previousComponent) {
      previousComponent = selected; frame.replaceChildren(); color.replaceChildren();
      const record = preview?.components.find(row => row.object === selected);
      if (record && preview) {
        try { for (const [index, source] of preview.framesFor(record).entries()) frame.append(option(String(index), source.label)); }
        catch { frame.append(option("0", "Unavailable")); }
        const keys = record.effectiveProperties.UseColorScale === true ? record.effectiveProperties.ColorScale : null;
        if (Array.isArray(keys)) keys.forEach((_, index) => color.append(option(String(index), `Key ${index + 1}`)));
        else color.append(option("", "Original color"));
      }
    }
    frame.value = String(state?.selection.frame ?? 0); color.value = state?.selection.colorKey === null ? "" : String(state?.selection.colorKey ?? "");
    const ready = state?.status === "ready" || state?.status === "hidden";
    frame.disabled = !ready || frame.options.length < 2; color.disabled = !ready || color.options.length < 2; inspect.disabled = state?.status !== "ready";
    status.textContent = unavailable ?? (!preview ? "Original skill components have not been staged." :
      state?.status === "failed" ? `Component unavailable: ${state.error}` : state?.status === "loading" ? "Loading original component…" :
      state?.status === "hidden" ? "Component hidden while the fighter is down." :
      "Inspect one original component on the fighter’s hand. Use Special attack preview to view it during motion. Full skill playback is still pending.");
  };
  component.addEventListener("change", () => { void preview?.select(component.value || null); }, { signal: lifetime.signal });
  frame.addEventListener("change", () => { void preview?.select(component.value || null, Number(frame.value)); }, { signal: lifetime.signal });
  color.addEventListener("change", () => { preview?.setColorKey(color.value === "" ? null : Number(color.value)); }, { signal: lifetime.signal });
  inspect.addEventListener("click", frameComponent, { signal: lifetime.signal });
  const unsubscribe = preview?.subscribe(update); update();
  return { dispose() { lifetime.abort(); unsubscribe?.(); root.remove(); } };
}
