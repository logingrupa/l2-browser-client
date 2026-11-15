import { loadNativeEnvironmentTables, selectNativeSkyLiteral, type NativeEnvironmentTables } from "./nativeEnvironmentTables";
import type { NativeSkyPresentation } from "./nativeSkyPresentation";

/** Explicit comparison only. Loading data or choosing an option never changes
 * the sky; applying a physical row requires its own user action. */
export function attachNativeSkyEnvironmentControls(host: HTMLElement, sky: NativeSkyPresentation) {
  const lifetime = new AbortController(), root = document.createElement("div");
  root.dataset.testid = "sky-environment-comparison";
  const heading = document.createElement("p"); heading.textContent = "Compare original environment colors";
  const note = document.createElement("p");
  note.textContent = "Temporary source-row preview. The native environment, time and interpolation are unverified. Stored sky materials stay unchanged.";
  const load = document.createElement("button"); load.type = "button"; load.textContent = "Load sky color tables";
  load.dataset.testid = "load-sky-tables";
  const options = document.createElement("div"); options.hidden = true;
  const fileLabel = document.createElement("label"); fileLabel.textContent = "Source file ";
  const file = document.createElement("select"); file.setAttribute("aria-label", "Sky environment source file"); fileLabel.append(file);
  const rowLabel = document.createElement("label"); rowLabel.textContent = "Physical color row ";
  const row = document.createElement("select"); row.setAttribute("aria-label", "Sky environment color row"); rowLabel.append(row);
  const actions = document.createElement("div"); actions.className = "secondary-actions";
  const apply = document.createElement("button"); apply.type = "button"; apply.textContent = "Compare selected sky row";
  const restore = document.createElement("button"); restore.type = "button"; restore.textContent = "Restore stored sky";
  const status = document.createElement("p"); status.role = "status"; status.dataset.testid = "sky-comparison-status";
  status.textContent = "Stored sky materials are active.";
  const fileField = document.createElement("div"), rowField = document.createElement("div");
  fileField.append(fileLabel); rowField.append(rowLabel);
  actions.append(apply, restore); options.append(fileField, rowField, actions);
  root.append(heading, note, load, options, status); host.append(root);
  let data: NativeEnvironmentTables | undefined, disposed = false;
  const fillRows = () => {
    row.replaceChildren();
    const tables = data!.tables.filter(table => table.file === file.value && table.section === "SkyBoxColor");
    if (tables.length !== 1) throw new Error("Missing or ambiguous background table.");
    for (const candidate of tables[0]!.rows) {
      const option = document.createElement("option"); option.value = candidate.key;
      option.textContent = `${candidate.key} · T=${candidate.tLiteral}`; row.append(option);
    }
    // Merely select a useful comparison row; no automatic color application.
    if (tables[0]!.rows.some(candidate => candidate.key === "COLOR13")) row.value = "COLOR13";
  };
  load.addEventListener("click", () => {
    load.disabled = true; status.textContent = "Loading original environment rows…";
    void loadNativeEnvironmentTables(lifetime.signal).then(loaded => {
      if (disposed) return;
      data = loaded; file.replaceChildren();
      for (const name of [...new Set(loaded.tables.map(table => table.file))]) {
        const option = document.createElement("option"); option.value = name; option.textContent = name; file.append(option);
      }
      fillRows(); options.hidden = false; load.hidden = true;
      status.textContent = "Tables loaded. Stored sky materials are still active; choose a row and compare.";
    }).catch(error => {
      if (disposed) return;
      load.disabled = false;
      status.textContent = `Sky comparison unavailable: ${error instanceof Error ? error.message : String(error)} Stored materials retained.`;
    });
  }, { signal: lifetime.signal });
  file.addEventListener("change", () => { try { fillRows(); } catch (error) { status.textContent = String(error); } }, { signal: lifetime.signal });
  apply.addEventListener("click", () => {
    if (!data) return;
    try {
      const selected = selectNativeSkyLiteral(data, file.value, row.value);
      sky.applyEnvironmentLiteral(data, file.value, row.value);
      const mismatch = selected.layers.some(layer => !layer.declaredNumMatchesPhysicalRows);
      status.textContent = `Comparing ${selected.file}, ${selected.key}, literal T=${selected.tLiteral}. Background, haze and cloud rows only; no native clock or interpolation.${mismatch ? " Source NUM differs from its physical row count; this preview selects the named physical row explicitly." : ""}`;
    } catch (error) { status.textContent = `Comparison not applied: ${error instanceof Error ? error.message : String(error)}`; }
  }, { signal: lifetime.signal });
  restore.addEventListener("click", () => { sky.restoreEnvironmentLiteral(); status.textContent = "Stored sky materials restored."; }, { signal: lifetime.signal });
  return { dispose() { if (disposed) return; disposed = true; lifetime.abort(); sky.restoreEnvironmentLiteral(); root.remove(); } };
}
