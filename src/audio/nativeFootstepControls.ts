import {
  FOOTSTEP_RANDOM_SEED, FOOTSTEP_SURFACES, FOOTSTEP_SURFACE_LABELS, surfaceVariationCount,
  type FootstepEvidenceStatus, type FootstepSurfaceId, type FootstepVariation,
} from "./footstepSurfaces";
import { DECO_GRASS_APPROXIMATION_LABEL } from "../assets/native/loadNativeStepDecoGrass";
import {
  NATIVE_FOOTSTEP_MODE_LABELS, NATIVE_FOOTSTEP_NOTIFY, type NativeFootstepDispatch, type NativeFootstepMode, type NativeFootstepPreview,
} from "./nativeFootstepPreview";

/** Structurally identical to the dev sheet's VariableInfo (hover-card rows).
 * `status`, `values` and `source` are getters, so cached rows stay live. */
export interface NativeFootstepControlRow {
  readonly name: string;
  readonly value: () => string;
  readonly values: string;
  readonly source: string;
  readonly status: FootstepEvidenceStatus;
}
export interface NativeFootstepControls {
  readonly element: HTMLElement;
  describe(): NativeFootstepControlRow[];
  /** Re-reads selection and the latest dispatch; also runs on an interval while visible. */
  refresh(): void;
  dispose(): void;
}
export interface NativeFootstepControlOptions {
  /** Load failure of the package-keyed stepsound bundle, shown in status. */
  readonly stepSoundFailure?: string | null;
  /** Load failure of the deco-grass bundle (the GRASS gate then stays LAND). */
  readonly decoGrassFailure?: string | null;
  readonly refreshMs?: number;
  /** Interval refreshes only run while this is true (e.g. the sheet is open). */
  readonly isVisible?: () => boolean;
  /** How long the Auto → Manual hint stays visible. */
  readonly hintMs?: number;
}

const modeOrder: readonly NativeFootstepMode[] = ["auto", "manual", "off"];
const modeChipLabels: Readonly<Record<NativeFootstepMode, string>> = { auto: "Auto", manual: "Manual", off: "Off" };
const contactLabels: Readonly<Record<string, string>> = { terrain: "terrain", "terrain-patch": "terrain patch", placement: "static mesh",
  bsp: "BSP", mesh: "mesh (no marker)", none: "no contact" };
const leaf = (reference: string | null) => reference?.split(".").at(-1) ?? "none";
const NATIVE_ORDER = "Native order (REPORT.md Q1): boots (additive) → support StepSound → water/step volume → non-terrain ACTOR → terrain GRASS/LAND.";

/** Plain DOM controls the dev sheet hosts. Every control carries a
 * `data-footstep-variable` naming its describe() row for hover-cards. */
export function attachNativeFootstepControls(host: HTMLElement, preview: NativeFootstepPreview, failure: string | null,
  options: NativeFootstepControlOptions = {}): NativeFootstepControls {
  const lifetime = new AbortController(), signal = lifetime.signal;
  const library = preview.stepSounds(), auto = preview.autoSurface(), available = preview.inspection().available > 0;
  let bootsLayer = preview.inspection().bootsLayer, lastWaterEvent = "none", latest: NativeFootstepDispatch | null = null;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  // A div[data-testid] gets the sheet's grid/gap rule for hosted module DOM.
  const root = document.createElement("div");
  root.className = "nfs"; root.dataset.testid = "native-footstep-controls"; root.setAttribute("role", "group"); root.setAttribute("aria-label", "Footsteps");

  const row = (label: string, variable: string, testid: string, layout: "inline" | "stacked" = "inline") => {
    const element = document.createElement("div"), title = document.createElement("span"), control = document.createElement("div");
    element.className = "dev-row"; element.dataset.layout = layout; element.dataset.footstepVariable = variable; element.dataset.testid = testid;
    title.className = "dev-row-label"; title.textContent = label; control.className = "dev-row-control";
    element.append(title, control); root.append(element);
    return { element, title, control };
  };
  const chipGroup = <T extends string>(parent: HTMLElement, ariaLabel: string, choices: readonly { value: T; label: string; testid: string }[],
    onSelect: (value: T) => void) => {
    const group = document.createElement("div"), buttons = new Map<T, HTMLButtonElement>();
    group.className = "dev-chips"; group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", ariaLabel);
    for (const choice of choices) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "dev-chip"; button.setAttribute("role", "radio"); button.setAttribute("aria-checked", "false");
      button.dataset.value = choice.value; button.dataset.testid = choice.testid; button.textContent = choice.label;
      button.addEventListener("click", () => onSelect(choice.value), { signal });
      group.append(button); buttons.set(choice.value, button);
    }
    parent.append(group);
    return { group, buttons };
  };
  const check = (buttons: ReadonlyMap<string, HTMLButtonElement>, value: string | null) => {
    for (const [key, button] of buttons) button.setAttribute("aria-checked", String(key === value));
  };
  const select = (patch: Partial<{ mode: NativeFootstepMode; surface: FootstepSurfaceId; variation: FootstepVariation }>) => {
    const current = preview.surfaceSelection();
    let next = { ...current, ...patch };
    const count = surfaceVariationCount(library, next.surface);
    if (typeof next.variation === "number" && next.variation >= count) next = { ...next, variation: Math.max(0, count - 1) };
    preview.setSurfaceSelection(next); render();
  };
  /** A manual choice made while Auto is active switches to Manual, with a short hint. */
  const manualChoice = (patch: Partial<{ surface: FootstepSurfaceId; variation: FootstepVariation }>) => {
    const wasAuto = preview.surfaceSelection().mode !== "manual";
    if (!library) return;
    select({ ...patch, mode: "manual" });
    if (!wasAuto) return;
    hint.hidden = false;
    hint.textContent = `Manual: ${FOOTSTEP_SURFACE_LABELS[preview.surfaceSelection().surface]}. Tap Auto to return to the native order.`;
    if (hintTimer !== undefined) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hintTimer = undefined; hint.hidden = true; }, options.hintMs ?? 4000);
  };

  const modeRow = row("Mode", "footsteps.mode", "native-footstep-mode");
  const modes = chipGroup(modeRow.control, "Footstep mode", modeOrder.map(mode => ({ value: mode, label: modeChipLabels[mode], testid: `native-footstep-mode-${mode}` })),
    mode => { hint.hidden = true; select({ mode }); });
  const decoRow = row("RenderDeco grass", "footsteps.renderDecoGrass", "native-footstep-render-deco");
  const deco = chipGroup(decoRow.control, "RenderDeco grass footsteps", [{ value: "on", label: "On", testid: "native-footstep-render-deco-on" },
    { value: "off", label: "Off", testid: "native-footstep-render-deco-off" }], value => { auto.setRenderDecoGrass(value === "on"); render(); });
  const surfaceRow = row("Surface", "footsteps.surface", "native-footstep-surface", "stacked");
  const surfaces = chipGroup(surfaceRow.control, "Footstep surface",
    FOOTSTEP_SURFACES.map(surface => ({ value: surface, label: FOOTSTEP_SURFACE_LABELS[surface], testid: `native-footstep-surface-${surface}` })),
    surface => manualChoice({ surface }));
  const hint = document.createElement("p");
  hint.className = "dev-note"; hint.dataset.testid = "native-footstep-hint"; hint.setAttribute("role", "status"); hint.hidden = true;
  root.append(hint);
  const variationRow = row("Variation", "footsteps.variation", "native-footstep-variation");
  let variations: { group: HTMLElement; buttons: Map<string, HTMLButtonElement> } | null = null, variationCount = -1;
  const buildVariations = (count: number) => {
    if (count === variationCount) return;
    variationCount = count; variations?.group.remove();
    variations = chipGroup(variationRow.control, "Footstep variation", [{ value: "random", label: "Random", testid: "native-footstep-variation-random" },
      ...Array.from({ length: count }, (_, index) => ({ value: String(index), label: String(index + 1), testid: `native-footstep-variation-${index + 1}` }))],
    value => manualChoice({ variation: value === "random" ? "random" : Number(value) }));
  };
  const bootsRow = row("Boot noise", "footsteps.bootsLayer", "native-footstep-boots");
  const boots = chipGroup(bootsRow.control, "Boot noise layer", [{ value: "off", label: "Off", testid: "native-footstep-boots-off" },
    { value: "on", label: "On", testid: "native-footstep-boots-on" }], value => { bootsLayer = value === "on"; preview.setBootsLayer(bootsLayer); render(); });
  const waterRow = row("Water test", "footsteps.waterTransitions", "native-footstep-water");
  const water = (event: "Water_In" | "Water_Out", label: string, testid: string) => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "dev-chip"; button.textContent = label; button.dataset.testid = testid;
    button.addEventListener("click", () => {
      lastWaterEvent = `${event}: ${preview.playWaterEvent(event) ? "played" : "not played (audio locked, muted or unavailable)"}`; render();
    }, { signal });
    waterRow.control.append(button);
    return button;
  };
  const waterIn = water("Water_In", "Water in", "native-footstep-water-in"), waterOut = water("Water_Out", "Water out", "native-footstep-water-out");
  const readout = (label: string, key: string) => {
    const { control } = row(label, "footsteps.readout", `native-footstep-readout-row-${key}`), output = document.createElement("output");
    output.className = "dev-readout"; output.dataset.testid = `native-footstep-readout-${key}`; output.textContent = "—";
    control.append(output);
    return output;
  };
  const readSurface = readout("Last step", "surface"), readClip = readout("Clip", "clip");
  const status = document.createElement("p");
  status.className = "dev-note"; status.dataset.tone = "warning"; status.dataset.testid = "native-footstep-status"; root.append(status);

  const statusText = () => failure ? `Footstep notify timing unavailable: ${failure}` :
    !available ? "Footstep notify timing has not been staged." :
    options.stepSoundFailure ? `Stepsound package unavailable (${options.stepSoundFailure}); Manual and support StepSounds are off.` :
    !library ? "Stepsound package not staged; Manual and support StepSounds are off." :
    options.decoGrassFailure ? `Deco-grass data unavailable (${options.decoGrassFailure}); terrain plays LAND.` : "";
  const resolvedLabel = (row: NativeFootstepDispatch | null) => row?.surface ? FOOTSTEP_SURFACE_LABELS[row.surface] : row?.reason === "native-silent" ? "silent" : "—";
  const render = () => {
    if (signal.aborted) return;
    const selection = preview.surfaceSelection();
    latest = preview.latest();
    check(modes.buttons, selection.mode);
    for (const [mode, button] of modes.buttons) button.disabled = !available || mode === "manual" && !library;
    check(deco.buttons, auto.renderDecoGrass() ? "on" : "off");
    const manual = selection.mode === "manual";
    check(surfaces.buttons, manual ? selection.surface : null);
    for (const [surface, button] of surfaces.buttons) {
      button.disabled = !available || !library || surfaceVariationCount(library, surface as FootstepSurfaceId) === 0;
      button.dataset.auto = String(selection.mode === "auto" && latest?.mode === "auto" && latest.surface === surface);
    }
    surfaceRow.title.textContent = selection.mode === "auto" ? `Surface · auto → ${resolvedLabel(latest?.mode === "auto" ? latest : null)}` :
      manual ? "Surface · manual" : "Surface";
    buildVariations(surfaceVariationCount(library, selection.surface) || 3);
    check(variations!.buttons, manual ? String(selection.variation) : null);
    for (const button of variations!.buttons.values()) button.disabled = !available || !library;
    check(boots.buttons, bootsLayer ? "on" : "off");
    for (const button of boots.buttons.values()) button.disabled = !available || !library?.boots.length;
    waterIn.disabled = waterOut.disabled = !library;
    readSurface.textContent = latest ? latest.mode === "auto" ? latest.resolution?.summary ?? resolvedLabel(latest) :
      latest.mode === "manual" ? `${resolvedLabel(latest)} · manual` : "off" : "—";
    readClip.textContent = latest ? `${latest.gait} · ${leaf(latest.reference)}${latest.variationIndex !== null ? ` #${latest.variationIndex + 1}` : ""} · ${latest.reason}` +
      latest.layers.map(layer => ` + ${layer.kind}${layer.accepted ? "" : " (dropped)"}`).join("") : "—";
    const text = statusText();
    status.hidden = !text; status.textContent = text;
  };
  const declared = () => library ? [...library.placements.values()] : [];
  const live = (rows: { name: string; value: () => string; values: string | (() => string); source: string | (() => string); status: FootstepEvidenceStatus | (() => FootstepEvidenceStatus) }[]) =>
    rows.map(entry => ({
      name: entry.name, value: entry.value,
      get values() { return typeof entry.values === "function" ? entry.values() : entry.values; },
      get source() { return typeof entry.source === "function" ? entry.source() : entry.source; },
      get status() { return typeof entry.status === "function" ? entry.status() : entry.status; },
    }));
  const describe = (): NativeFootstepControlRow[] => live([
    { name: "footsteps.mode", value: () => NATIVE_FOOTSTEP_MODE_LABELS[preview.surfaceSelection().mode],
      values: modeOrder.map(mode => NATIVE_FOOTSTEP_MODE_LABELS[mode]).join(" | "), status: "native",
      source: `${NATIVE_ORDER} Manual and Off are browser test modes.` },
    { name: "footsteps.surface", value: () => {
      const selection = preview.surfaceSelection(), stored = FOOTSTEP_SURFACE_LABELS[selection.surface];
      return selection.mode === "auto" ? `auto → ${resolvedLabel(preview.latest())} (manual: ${stored})` : selection.mode === "manual" ? stored : `off (manual: ${stored})`;
    },
    values: FOOTSTEP_SURFACES.map(surface => `${surface} (${surfaceVariationCount(library, surface)})`).join(" | "),
    status: () => preview.surfaceSelection().mode === "auto" ? preview.latest()?.resolution?.status ?? "presentation" : "native",
    source: `16 original stepsound.uax groups (${library?.soundCount ?? 0} Sounds${library ? `, package ${library.packageSha256.slice(0, 12)}…` : ""}). ` +
      "No SurfaceType/material footstep field exists; tapping a surface in Auto switches to Manual." },
    { name: "footsteps.variation", value: () => { const value = preview.surfaceSelection().variation; return value === "random" ? "Random" : String(value + 1); },
      values: "Random | 1..N (N = actual clips: Stone 2, others 3)", status: "presentation",
      source: `Manual only. Random is a uniform slot draw (repeats allowed, like native appRand() % 3) from a seeded generator (seed 0x${FOOTSTEP_RANDOM_SEED.toString(16)}; presentation choice).` },
    { name: "footsteps.gait", value: () => { const row = preview.latest(); return row ? `${row.gait} (${row.gaitSource}; clip ${row.clipGait})` : "—"; },
      values: "walk | run", status: () => preview.latest()?.gaitSource === "clip" ? "unverified" : "native",
      source: "Controller.MoveType (PMT_SLOW walk, PMT_FAST run) selects the walk/run array; the browser reads the movement state. ACTOR and support StepSounds ignore gait." },
    { name: "footsteps.auto.rule", value: () => { const row = preview.latest(); return row?.resolution ? `${row.resolution.rule} · ${row.resolution.summary}` : "—"; },
      values: "support-step-sound | water-volume | step-volume | actor | grass | land | no-support",
      status: () => preview.latest()?.resolution?.status ?? "presentation", source: () => preview.latest()?.resolution?.reason ?? NATIVE_ORDER },
    { name: "footsteps.auto.support", value: () => {
      const context = preview.latest()?.context;
      return context ? [contactLabels[context.kind] ?? context.kind, context.sourceId ?? context.meshName, context.material].filter(Boolean).join(" · ") : "—";
    }, values: Object.values(contactLabels).join(" | "), status: "unverified",
    source: "Accepted browser movement support (WorldGroundContact controlling sample), standing in for native Pawn.Base; seeded at spawn." },
    { name: "footsteps.auto.supportStepSounds", value: () => `${declared().length} placements · ${[...new Set(declared().flatMap(row => row.references))].join(", ") || "none"}`,
      values: "StepSound_1 (2/3) | StepSound_3 (1/3); StepSound_2 never", status: "native",
      source: `StaticMeshActor StepSound_1..3 in maps/20_20.unr (${library?.sectionManifestSha256 ? `section ${library.sectionManifestSha256.slice(0, 12)}…` : "not staged"}), staged by the stepsound package; AStaticMeshActor::GetStepSoundData 0x106f42e0.` },
    { name: "footsteps.auto.actor", value: () => "Stone_Hard_Walk_01..03 (walk array, both gaits)", values: "ACTOR", status: "native",
      source: "Non-terrain support without a StepSound (other meshes, movers; BSP conditional) → ACTOR = DefaultActorWalkSound; DefActorRun is never read. Not ordinary Stone." },
    { name: "footsteps.auto.terrain", value: () => {
      const reading = preview.latest()?.context?.decoGrass;
      return reading ? `${reading.grass ? "GRASS" : "LAND"} · deco ≈ ${reading.expected.toFixed(2)} (≥ ${reading.threshold} → Grass)` : "LAND unless the deco gate passes";
    }, values: "GRASS (Grass walk/run) | LAND (Default walk/run)", status: "presentation",
    source: `${DECO_GRASS_APPROXIMATION_LABEL}. Native: GetDecoLayerAlpha counts generated instances within 64 units XY in the nearest sector; > 1 → GRASS, local player only.` },
    { name: "footsteps.renderDecoGrass", value: () => auto.renderDecoGrass() ? "on" : "off", values: "on | off (default on)", status: "presentation",
      source: `RenderDeco grass footsteps. Native decorations exist only with Option.ini RenderDeco on (retained Option.ini: True); off → terrain is always LAND. ${DECO_GRASS_APPROXIMATION_LABEL}.` },
    { name: "footsteps.bootsLayer", value: () => bootsLayer ? "on" : "off", values: "on | off (default off)", status: "presentation",
      source: "Native boots (SoundableBootsClassID) add a sound and continue the chain; the browser layers stepsound.noise_boots.noise_01..03 (item boot lists not staged)." },
    { name: "footsteps.waterTransitions", value: () => lastWaterEvent, values: "Water_In | Water_Out", status: "presentation",
      source: "stepsound.water.Water_In/Water_Out test actions; Auto fires them on WATER transitions. 20_20 has no water volumes." },
    { name: "footsteps.playback", value: () => {
      const spatial = preview.latest()?.spatial;
      return spatial ? `gain ${spatial.gain.toFixed(3)} · ${Math.round(spatial.distanceUnits)} units` : `gain ${(NATIVE_FOOTSTEP_NOTIFY.volume / 255).toFixed(3)} · non-spatial`;
    }, values: `Volume ${NATIVE_FOOTSTEP_NOTIFY.volume}/255 · Radius ${NATIVE_FOOTSTEP_NOTIFY.radius}`, status: "presentation",
    source: "At the pawn Location with the notify's Volume 250 / Radius 30. Attenuation reuses the ambient curve (ALAudio actor-source gain unproved); listener = local pawn (presentation choice)." },
    { name: "footsteps.lastClip", value: () => preview.latest()?.reference ?? "—", values: "exact original object path", status: "native",
      source: "Exact original Sound object played (unchanged PCM WAV payload)." },
  ]);
  host.append(root);
  render();
  const visible = () => !signal.aborted && (options.isVisible?.() ?? true) &&
    (typeof root.checkVisibility !== "function" || root.checkVisibility());
  const timer = setInterval(() => { if (visible()) render(); }, Math.max(100, options.refreshMs ?? 300));
  signal.addEventListener("abort", () => { clearInterval(timer); if (hintTimer !== undefined) clearTimeout(hintTimer); }, { once: true });
  return { element: root, describe, refresh: render, dispose() { if (signal.aborted) return; lifetime.abort(); root.remove(); } };
}
