import type { Scene } from "@babylonjs/core/scene";
import { readAssetPackage, assetPackageLimits, type AssetPackageManifest } from "../assets/package/readAssetPackage";
import { createPackagePreview, type PackagePreview } from "../assets/package/PackagePreview";

export interface AssetImportOptions { host: HTMLElement; onOpenChange?: (open: boolean) => void }
export interface AssetPackageInspection {
  open: boolean; loading: boolean; name: string | null; kind: string | null; sourceEdition: string | null;
  clips: PackagePreview["clips"];
  preview: ReturnType<PackagePreview["snapshot"]> | null;
}
declare global { interface Window { __assetPackageInspection?: { snapshot(): AssetPackageInspection; sampleDeformation(): ReturnType<PackagePreview["sampleDeformation"]> } } }

const styles = String.raw`
.asset-import-open,.asset-import-panel{font-family:"Segoe UI",system-ui,sans-serif;color:#f5ecd8;color-scheme:dark}
.asset-import-open{min-height:44px;padding:8px 14px;border:1px solid rgb(191 167 111 / 55%);background:#303b35;font-size:12px;cursor:pointer}
.asset-import-panel{width:min(1100px,calc(100vw - 48px));height:min(850px,calc(100dvh - 48px));max-width:none;max-height:none;margin:auto;padding:0;border:1px solid #a58c59;background:#202522;overflow:hidden}
.asset-import-panel[open]{display:flex;flex-direction:column}
.asset-import-panel::backdrop{background:rgb(12 18 15 / 78%)}
.asset-import-panel,.asset-import-panel *{box-sizing:border-box}
.asset-import-panel *{scrollbar-color:#a58c59 #202522;scrollbar-width:thin}
.asset-import-panel ::selection{background:#79704a;color:#fff1cf}
.asset-import-panel button,.asset-import-panel select{font:inherit;min-height:44px;color:#f5ecd8;background:#303b35;border:1px solid rgb(191 167 111 / 55%);padding:8px 12px;border-radius:0}
.asset-import-panel button{cursor:pointer}
.asset-import-panel button:disabled{opacity:.5;cursor:default}
.asset-import-open:hover,.asset-import-panel button:hover:enabled{background:#4b574a}
.asset-import-panel button:active,.asset-import-open:active{background:#79704a}
.asset-import-open:focus-visible,.asset-import-panel :is(button,select,summary,canvas):focus-visible{outline:2px solid #ffe0a3;outline-offset:3px}
.asset-import-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 20px;border-bottom:1px solid rgb(191 167 111 / 35%)}
.asset-import-header h2{font:600 30px/1.1 "Cormorant Garamond Variable",Georgia,serif;margin:0;color:#edcd88;text-wrap:balance}
.asset-import-header p{font-size:12px;line-height:1.5;color:#d0c6af;margin:4px 0 0;max-width:65ch}
.asset-import-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 20px;font-size:13px}
.asset-import-toolbar>span{color:#d0c6af;font-size:12px}
.asset-import-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 280px;border-top:1px solid rgb(191 167 111 / 35%)}
.asset-import-view{position:relative;min-height:0;background:#171d1b;overflow:hidden}
.asset-import-empty{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:24px;text-align:center;gap:10px}
.asset-import-empty strong{font:600 26px/1.15 "Cormorant Garamond Variable",Georgia,serif;color:#edcd88}
.asset-import-empty p{font-size:13px;line-height:1.6;color:#d0c6af;max-width:38ch;margin:0}
.asset-preview-content{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.asset-preview-content canvas{width:100%;height:100%;display:block;touch-action:none;outline-offset:-4px!important}
.asset-preview-content img{max-width:100%;max-height:100%;object-fit:contain}
.asset-preview-content audio{width:min(420px,calc(100% - 32px))}
.asset-import-details{padding:18px 16px;overflow:auto;border-left:1px solid rgb(191 167 111 / 35%);font-size:13px;line-height:1.5}
.asset-import-details h3{margin:0 0 6px;font-size:16px;font-weight:600;overflow-wrap:anywhere}
.asset-import-details p{margin:0 0 16px;color:#d0c6af}
.asset-import-details label{display:block;margin-bottom:6px}
.asset-import-details select{width:100%;margin-bottom:10px;font-size:12px;text-overflow:ellipsis}
.asset-import-details [data-clip-toggle]{width:100%;margin-bottom:18px}
.asset-import-details .asset-sound-toggle{display:flex;align-items:center;gap:10px;min-height:44px;cursor:pointer}
.asset-sound-toggle input{width:18px;height:18px;accent-color:#edcd88}
.asset-import-details [data-sounds] p{font-size:11px;line-height:1.5}
.asset-import-details details{border-top:1px solid rgb(191 167 111 / 35%);padding-top:6px;margin-top:12px}
.asset-import-details summary{padding:10px 0;min-height:44px;cursor:pointer;color:#edcd88}
.asset-import-details dl{margin:0;overflow-wrap:anywhere}
.asset-import-details dt{color:#d0c6af;font-size:11px;margin-top:12px}
.asset-import-details dd{margin:2px 0 0;font-size:12px}
.asset-import-details ul{padding-left:18px;margin:4px 0 16px;font-size:12px;color:#d0c6af}
.asset-import-details li+li{margin-top:8px}
.asset-import-details pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,Consolas,monospace;color:#d0c6af}
.asset-import-status{margin:0;padding:10px 20px;border-top:1px solid rgb(191 167 111 / 35%);font-size:12px;line-height:1.5;color:#d0c6af;min-height:40px}
.asset-import-status[data-error="true"]{color:#ffcfb7}
.asset-import-panel[data-dragging="true"] .asset-import-view{outline:2px solid #edcd88;outline-offset:-2px}
.asset-import-panel [hidden]{display:none!important}
@media(max-width:700px){
 .asset-import-panel{width:100vw;height:100dvh;border:0}
 .asset-import-header{padding:max(12px,env(safe-area-inset-top)) 12px 12px;gap:10px}
 .asset-import-header h2{font-size:26px}.asset-import-header p{font-size:11px}
 .asset-import-toolbar{padding:10px 12px;gap:8px}
 .asset-import-body{grid-template-columns:1fr;grid-template-rows:minmax(180px,1fr) minmax(0,35%)}
 .asset-import-details{border-left:0;border-top:1px solid rgb(191 167 111 / 35%);padding:12px}
 .asset-import-details h3{font-size:15px}.asset-import-details p{margin-bottom:10px}
 .asset-import-status{padding:10px 12px max(10px,env(safe-area-inset-bottom))}
}
@media(max-height:500px) and (min-width:701px){.asset-import-panel{height:100dvh;width:100vw;border:0}.asset-import-header{padding:8px 12px}.asset-import-header p{display:none}.asset-import-toolbar{padding:6px 12px}.asset-import-body{grid-template-columns:minmax(0,1fr) 250px}}
`;

export function attachAssetImport(worldScene: Scene, canvas: HTMLCanvasElement, options: AssetImportOptions): () => void {
  const events = new AbortController(), stylesheet = document.createElement("style");
  stylesheet.textContent = styles; document.head.append(stylesheet);
  const button = document.createElement("button");
  button.type = "button"; button.className = "asset-import-open"; button.textContent = "Assets";
  button.setAttribute("aria-haspopup", "dialog"); button.dataset.testid = "asset-import-open";
  options.host.append(button);
  const dialog = document.createElement("dialog"); dialog.className = "asset-import-panel"; dialog.setAttribute("aria-label", "Asset inspector");
  dialog.innerHTML = `<header class="asset-import-header"><div><h2>Asset inspector</h2><p>Interlude assets, in their own scene. The world stays separate.</p></div><button type="button" data-close>Close</button></header>
    <div class="asset-import-toolbar"><button type="button" data-browse>Browse packages</button><span>Drop a .l2asset package here or onto the world.</span><input type="file" accept=".l2asset" aria-label="Choose an asset package" hidden></div>
    <div class="asset-import-body"><div class="asset-import-view"><div class="asset-import-empty"><strong>Inspect a converted asset</strong><p>Open a model, texture, or sound package. Models keep their original proportions, hierarchy, and clip names.</p></div></div>
    <aside class="asset-import-details" aria-label="Asset details"><h3 data-name>No asset loaded</h3><p data-summary>Choose a local package to begin.</p><p data-scale hidden>Scale 1:1 · glTF metres. Drag to orbit; scroll or pinch to zoom.</p><div data-animation hidden><label for="asset-native-clip">Native animation</label><select id="asset-native-clip"></select><button type="button" data-clip-toggle>Play animation</button><div data-sounds hidden><label class="asset-sound-toggle"><input type="checkbox">Play linked sounds</label><p>Previews verified sound links at their authored times. Original volume, random selection, and game conditions are not reproduced.</p></div></div>
    <details data-source hidden><summary>Source details</summary><dl data-metadata></dl><h4>Conversion limits</h4><ul data-limitations></ul><details data-events hidden><summary>Animation event metadata</summary><pre></pre></details></details></aside></div>
    <p class="asset-import-status" role="status" aria-live="polite">Packages are read locally.</p>`;
  document.body.append(dialog);
  const find = <T extends Element = HTMLElement>(selector: string): T => {
    const element = dialog.querySelector<T>(selector); if (!element) throw new Error(`Missing asset inspector element: ${selector}`); return element;
  };
  const input = find<HTMLInputElement>('input[type="file"]'), view = find<HTMLElement>(".asset-import-view"), status = find<HTMLElement>(".asset-import-status");
  const select = find<HTMLSelectElement>("select"), toggle = find<HTMLButtonElement>("[data-clip-toggle]");
  let preview: PackagePreview | undefined, manifest: AssetPackageManifest | undefined, pending: AbortController | undefined;
  let disposed = false, loading = false, sequence = 0;
  const setStatus = (message: string, error = false) => { status.textContent = message; status.dataset.error = String(error); };
  function open(): void {
    if (disposed || dialog.open) return;
    dialog.showModal(); options.onOpenChange?.(true);
  }
  function clear(): void {
    sequence++; pending?.abort(); pending = undefined; loading = false;
    preview?.dispose(); preview = undefined; manifest = undefined;
    find(".asset-import-empty").removeAttribute("hidden");
    find("[data-name]").textContent = "No asset loaded"; find("[data-summary]").textContent = "Choose a local package to begin.";
    for (const selector of ["[data-scale]", "[data-animation]", "[data-source]"]) find(selector).setAttribute("hidden", "");
    input.value = ""; dialog.removeAttribute("aria-busy");
  }
  function close(): void {
    if (!dialog.open) return;
    clear(); dialog.close(); options.onOpenChange?.(false); button.focus(); setStatus("Packages are read locally.");
  }
  function metadataRow(label: string, value: string): void {
    const term = document.createElement("dt"), description = document.createElement("dd"); term.textContent = label; description.textContent = value;
    find("[data-metadata]").append(term, description);
  }
  async function importFile(file: File): Promise<void> {
    open();
    if (!/\.l2asset$/i.test(file.name)) { setStatus("Choose a .l2asset package made by the conversion tool.", true); return; }
    if (file.size > assetPackageLimits.archiveBytes) { setStatus("This package exceeds 128 MiB. Export a smaller asset package.", true); return; }
    const current = ++sequence; pending?.abort();
    const controller = new AbortController(); pending = controller; loading = true; dialog.setAttribute("aria-busy", "true");
    setStatus(`Checking ${file.name}…`);
    let candidate: PackagePreview | undefined;
    try {
      const asset = await readAssetPackage(await file.arrayBuffer());
      controller.signal.throwIfAborted();
      setStatus(`Opening ${asset.manifest.name}…`);
      candidate = await createPackagePreview(asset, view, controller.signal);
      if (disposed || current !== sequence || controller.signal.aborted) { candidate.dispose(); return; }
      preview?.dispose(); preview = candidate; manifest = asset.manifest;
      candidate.element.style.visibility = "visible";
      find(".asset-import-empty").setAttribute("hidden", "");
      find("[data-name]").textContent = manifest.name; find("[data-summary]").textContent = candidate.summary;
      find("[data-scale]").toggleAttribute("hidden", manifest.kind !== "model");
      find("[data-animation]").toggleAttribute("hidden", candidate.clips.length === 0);
      select.replaceChildren(...candidate.clips.map((clip, index) => { const option = document.createElement("option"); option.value = String(index); option.textContent = clip.name; return option; }));
      toggle.textContent = "Play animation";
      find("[data-sounds]").toggleAttribute("hidden", !candidate.snapshot().linkedSounds?.available);
      find<HTMLInputElement>("[data-sounds] input").checked = false;
      find("[data-source]").removeAttribute("hidden"); find("[data-metadata]").replaceChildren();
      metadataRow("Edition", "Interlude"); metadataRow("Package", manifest.source.package); metadataRow("Object", manifest.source.object);
      if (manifest.model) { metadataRow("Unit", `1 metre = ${manifest.model.sourceUnitsPerMetre} source units`); metadataRow("Viewer scale", "1:1 — no size normalization"); }
      metadataRow("Source SHA-256", manifest.source.sha256);
      find("[data-limitations]").replaceChildren(...(manifest.limitations.length ? manifest.limitations : ["No conversion limitations recorded."]).map(message => { const item = document.createElement("li"); item.textContent = message; return item; }));
      find("[data-events]").toggleAttribute("hidden", !manifest.animationEvents?.length);
      find("[data-events] pre").textContent = manifest.animationEvents ? JSON.stringify(manifest.animationEvents, null, 2) : "";
      setStatus(`${manifest.name} ready.${manifest.limitations.length ? ` ${manifest.limitations.length} conversion limitation${manifest.limitations.length === 1 ? "" : "s"} recorded in Source details.` : ""}`);
    } catch (error) {
      candidate?.dispose();
      if (current === sequence && !controller.signal.aborted && !disposed) setStatus(`${error instanceof Error ? error.message : "The package could not be opened."}${preview ? " Your current asset is still open." : " Choose another package or rebuild it."}`, true);
    } finally {
      if (current === sequence) { pending = undefined; loading = false; dialog.removeAttribute("aria-busy"); }
    }
  }
  const listenerOptions = { signal: events.signal };
  button.addEventListener("click", open, listenerOptions);
  find("[data-close]").addEventListener("click", close, listenerOptions);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); }, listenerOptions);
  find("[data-browse]").addEventListener("click", () => input.click(), listenerOptions);
  input.addEventListener("change", () => { const file = input.files?.[0]; input.value = ""; if (file) void importFile(file); }, listenerOptions);
  toggle.addEventListener("click", () => {
    if (!preview) return;
    if (preview.snapshot().playing) { preview.pause(); toggle.textContent = "Play animation"; }
    else { preview.play(Number(select.value)); toggle.textContent = "Pause animation"; }
  }, listenerOptions);
  select.addEventListener("change", () => { preview?.pause(); toggle.textContent = "Play animation"; }, listenerOptions);
  find<HTMLInputElement>("[data-sounds] input").addEventListener("change", event => {
    const checkbox = event.currentTarget as HTMLInputElement, selected = preview;
    if (!selected) return;
    void selected.setLinkedSounds(checkbox.checked).then(() => {
      if (preview !== selected) return;
      const sound = selected.snapshot().linkedSounds;
      checkbox.checked = sound?.enabled ?? false;
      if (sound?.error) setStatus(`Linked sounds could not play: ${sound.error}`, true);
    });
  }, listenerOptions);
  for (const dropTarget of [canvas, dialog]) {
    dropTarget.addEventListener("dragover", event => { event.preventDefault(); if (event instanceof DragEvent && event.dataTransfer) event.dataTransfer.dropEffect = "copy"; dialog.dataset.dragging = "true"; }, listenerOptions);
    dropTarget.addEventListener("dragleave", () => { delete dialog.dataset.dragging; }, listenerOptions);
    dropTarget.addEventListener("drop", event => {
      event.preventDefault(); delete dialog.dataset.dragging;
      const files = event instanceof DragEvent ? event.dataTransfer?.files : undefined;
      if (!files?.length) return;
      if (files.length !== 1) { open(); setStatus("Drop one asset package at a time.", true); return; }
      void importFile(files[0]!);
    }, listenerOptions);
  }
  const diagnostics = { snapshot: (): AssetPackageInspection => ({ open: dialog.open, loading, name: manifest?.name ?? null, kind: manifest?.kind ?? null,
    sourceEdition: manifest?.source.edition ?? null, clips: preview?.clips ?? [], preview: preview?.snapshot() ?? null }), sampleDeformation: () => preview?.sampleDeformation() ?? null };
  window.__assetPackageInspection = diagnostics;
  const observer = worldScene.onDisposeObservable.addOnce(() => dispose());
  function dispose(): void {
    if (disposed) return; close(); disposed = true; clear(); events.abort(); worldScene.onDisposeObservable.remove(observer);
    button.remove(); dialog.remove(); stylesheet.remove();
    if (window.__assetPackageInspection === diagnostics) delete window.__assetPackageInspection;
  }
  return dispose;
}
