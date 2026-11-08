import type { EntityRegistry } from "../entities/EntityRegistry";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { WorldCommand } from "../world/worldTypes";
import { worldStyles } from "./worldStyles";
import { canvasHudInset } from "./canvasHudInset";
import { DevSheet, type DevGroup } from "./devSheet/DevSheet";
import type { DevSheetStorage } from "./devSheet/devSheetState";
import { iconMarkup } from "./devSheet/icons";

const swordIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 17 11-13 2 1-1 4L8 19M5 14l5 6M3 21l4-4"/></svg>';
const speakerIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10Z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/></svg>';

export interface WorldInterfaceOptions {
  storage?: DevSheetStorage | null;
}

export interface StatusOptions {
  transient?: boolean;
}

const soundGestureStates = new Set(["locked", "suspended", "interrupted", "unlocking"]);
export const transientStatusSeconds = 4;

export class WorldInterface {
  readonly root = document.createElement("section");
  readonly labels = document.createElement("div");
  readonly sheet: DevSheet;
  readonly generalGroup: DevGroup;
  private readonly events = new AbortController();
  private isPaused = false;
  private elapsedSeconds = 0;
  private diagnosticsInitialized = false;
  private readonly stylesheet = document.createElement("style");
  private previousBounds = "";
  private readonly status: HTMLElement;
  private readonly soundCue: HTMLButtonElement;
  private statusTransient = false;
  private statusAge = 0;
  private statusOrigin: { x: number; z: number } | null = null;
  private soundState: (() => boolean | string | null | undefined) | null = null;
  private soundUnlock: (() => unknown) | null = null;
  private gait: (() => string | null | undefined) | null = null;
  private readonly resizeObserver: ResizeObserver | null;

  constructor(private readonly adapter: GameWorldAdapter, private readonly getRegistry: () => EntityRegistry, private readonly canvas: HTMLCanvasElement,
    private readonly environment: { location: string; coordinateUnit: string } = { location: "Proving grounds", coordinateUnit: "m" },
    options: WorldInterfaceOptions = {}) {
    this.stylesheet.textContent = worldStyles;
    document.head.append(this.stylesheet);
    this.root.className = "world-interface";
    this.root.setAttribute("aria-label", "World controls");
    this.root.innerHTML = `
      <header class="world-header">
        <div class="player-panel">
          <div class="player-emblem" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M24 5 39 14v17L24 43 9 31V14Z"/><path d="m16 32 8-20 8 20M19 26h10"/></svg></div>
          <div class="player-information"><strong><span data-testid="player-name">Entering…</span><span>You</span></strong><div class="player-health"><span></span><b>HP <output data-testid="player-health">—</output></b></div><small>Synthetic world</small></div>
        </div>
        <div class="world-location"><h1>Proving grounds</h1><span>Client foundation · Phase 1</span></div>
      </header>
      <div class="target-panel" aria-live="polite"><span>Target</span><strong data-testid="target-name">No target</strong><small data-testid="target-health">Tap a character to select</small></div>
      <div class="world-bottom">
        <button type="button" class="hud-sound-cue" data-testid="hud-sound-cue" hidden>${speakerIcon}<span>Tap anywhere for sound</span></button>
        <p class="world-message" data-testid="world-status" role="status">Entering the world…</p>
        <div class="diagnostics" aria-label="World diagnostics"><span><output data-testid="fps">0</output> FPS</span><span><output data-testid="entity-count">0</output> entities</span><output data-testid="coordinates">0.0, 0.0, 0.0</output></div>
        <div class="hud-command-row">
          <div class="action-bar" role="group" aria-label="Character actions">
            <button type="button" data-action="attack" class="attack-action">${swordIcon}<span>Attack</span></button>
            <button type="button" data-action="run"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="15" cy="4" r="2"/><path d="m4 12 5-4 6 2 2 4h4M13 10l-3 6-5 4M10 16l6 2v4"/></svg><span>Run</span></button>
            <button type="button" data-action="idle"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4" r="2"/><path d="M12 7v9m-6-5 6-3 6 3m-6 5-4 6m4-6 4 6"/></svg><span>Idle</span></button>
            <button type="button" data-action="teleport"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-8 11h6l-1 9 9-12h-7Z"/></svg><span>Teleport</span></button>
            <button type="button" data-action="spawn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg><span>Spawn</span></button>
          </div>
          <button type="button" class="dev-sheet-toggle" data-testid="dev-sheet-toggle" aria-expanded="false" aria-label="Developer sheet">${iconMarkup("sheet")}<span aria-hidden="true">Dev</span></button>
        </div>
      </div>`;
    this.labels.className = "entity-labels";
    this.element(".world-location h1").textContent = environment.location;
    this.labels.setAttribute("aria-label", "World characters");
    document.body.append(this.labels, this.root);
    this.status = this.element('[data-testid="world-status"]');
    this.soundCue = this.element('[data-testid="hud-sound-cue"]') as HTMLButtonElement;
    this.sheet = new DevSheet({
      host: this.root, canvas, worldTargets: [canvas],
      toggle: this.element('[data-testid="dev-sheet-toggle"]') as HTMLButtonElement,
      ...(options.storage !== undefined ? { storage: options.storage } : {}),
      topReserve: () => this.topReserve(),
      bottomReserve: () => this.bottomReserve(),
      onLayoutChange: () => this.updateBounds(),
    });
    this.generalGroup = this.sheet.section("general", { title: "General", icon: "general", order: 0 }).group("session", "Session", {
      hint: "Attack, Run and Idle are animation demonstrations. Pause stops the synthetic simulation; camera controls and manual commands keep working.",
    });
    this.generalGroup.element.classList.add("demo-controls-body");
    this.generalGroup.element.innerHTML = `<div class="secondary-actions"><button type="button" data-action="pause">Pause</button><button type="button" data-action="despawn" disabled>Despawn target</button></div>
      <p class="dev-hud-help">Tap to target or move · drag to orbit · pinch or scroll to zoom.</p>`;
    this.sheet.describe(this.element(".dev-hud-help"), {
      title: "World controls",
      description: "Tap a character to target it and the ground to move. Drag to orbit and pinch to zoom; with a mouse, right-drag and scroll. All names, health and movement are synthetic.",
    });
    this.updateBounds();
    this.root.addEventListener("click", (event) => this.handleClick(event), { signal: this.events.signal });
    this.soundCue.addEventListener("click", () => { try { void this.soundUnlock?.(); } catch { this.renderSound(); return; } this.renderSound(); }, { signal: this.events.signal });
    this.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.sheet.layout()) : null;
    for (const selector of [".world-header", ".target-panel", ".world-bottom"]) {
      const element = this.root.querySelector(selector);
      if (element) this.resizeObserver?.observe(element);
    }
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    void fonts?.ready?.then(() => { if (!this.events.signal.aborted) this.sheet.layout(); }, () => undefined);
  }

  private element(selector: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing interface element: ${selector}`);
    return element;
  }

  private topReserve(): number {
    const stageTop = this.canvas.parentElement?.getBoundingClientRect().top ?? 0;
    let bottom = 0;
    for (const selector of [".world-header", ".target-panel"]) {
      const rect = this.root.querySelector(selector)?.getBoundingClientRect();
      if (rect && rect.height > 0) bottom = Math.max(bottom, rect.bottom);
    }
    return bottom > 0 ? Math.ceil(bottom - stageTop) : 0;
  }

  private bottomReserve(): number {
    const rect = this.root.querySelector(".world-bottom")?.getBoundingClientRect();
    return rect && rect.height > 0 ? Math.ceil(rect.height + 18) : 0;
  }

  private handleClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    let command: WorldCommand;
    switch (action) {
      case "attack": case "run": case "idle": command = { type: "set-animation", animation: action }; break;
      case "teleport": command = { type: "teleport-local" }; break;
      case "spawn": command = { type: "spawn" }; break;
      case "despawn": {
        const selected = this.getRegistry().selectedEntityId;
        if (!selected) return;
        command = { type: "despawn", entityId: selected }; break;
      }
      case "pause":
        this.isPaused = !this.isPaused;
        button.textContent = this.isPaused ? "Resume" : "Pause";
        command = { type: "set-paused", isPaused: this.isPaused }; break;
      default: this.renderGait(); return;
    }
    this.adapter.dispatch(command);
    this.renderGait();
    if (action !== "pause") this.showStatus(`${button.textContent?.trim()} demonstration`, { transient: true });
  }

  showStatus(message: string, options: StatusOptions = {}): void {
    this.status.textContent = message;
    this.statusTransient = options.transient === true && message.length > 0;
    this.statusAge = 0;
    this.statusOrigin = this.statusTransient ? this.playerGround() : null;
  }

  clearStatus(): void { this.showStatus(""); }

  watchSound(read: () => boolean | string | null | undefined, unlock?: () => unknown): () => void {
    this.soundState = read; this.soundUnlock = unlock ?? null;
    this.renderSound();
    return () => { if (this.soundState !== read) return; this.soundState = null; this.soundUnlock = null; this.renderSound(); };
  }

  bindGait(read: () => string | null | undefined): () => void {
    this.gait = read;
    this.renderGait();
    return () => { if (this.gait !== read) return; this.gait = null; this.renderGait(); };
  }

  private renderSound(): void {
    let state: boolean | string | null | undefined = null;
    try { state = this.soundState?.(); } catch { state = null; }
    const needsGesture = state === true || (typeof state === "string" && soundGestureStates.has(state));
    if (this.soundCue.hidden === needsGesture) this.soundCue.hidden = !needsGesture;
    this.soundCue.dataset.state = typeof state === "boolean" ? state ? "locked" : "running" : state ?? "none";
  }

  private renderGait(): void {
    let mode: string | null | undefined = null;
    try { mode = this.gait?.(); } catch { mode = null; }
    for (const action of ["run", "walk"]) {
      const button = this.root.querySelector(`.action-bar [data-action="${action}"]`);
      if (!button) continue;
      if (mode === "run" || mode === "walk") {
        const pressed = String(mode === action);
        if (button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
      } else button.removeAttribute("aria-pressed");
    }
  }

  private playerGround(): { x: number; z: number } | null {
    try {
      const position = this.getRegistry().localPlayerPosition;
      return position ? { x: position.x, z: position.z } : null;
    } catch { return null; }
  }

  private updateTransientStatus(deltaTimeSeconds: number): void {
    if (!this.statusTransient) return;
    this.statusAge += deltaTimeSeconds;
    const now = this.playerGround(), origin = this.statusOrigin;
    if (now && !origin) this.statusOrigin = now;
    const moved = now !== null && origin !== null && Math.hypot(now.x - origin.x, now.z - origin.z) > .05;
    if (moved || this.statusAge >= transientStatusSeconds) this.clearStatus();
  }

  private updateBounds(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const topInset = canvasHudInset(this.canvas, bounds);
    const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height},${topInset}`;
    if (key === this.previousBounds) return;
    this.previousBounds = key;
    for (const overlay of [this.root, this.labels]) {
      const inset = overlay === this.root ? topInset : 0;
      Object.assign(overlay.style, { inset: "auto", left: `${bounds.x}px`, top: `${bounds.y + inset}px`, width: `${bounds.width}px`, height: `${bounds.height - inset}px` });
    }
    this.labels.style.clipPath = topInset ? `inset(${topInset}px 0 0)` : "";
    (this.sheet as DevSheet | undefined)?.layout();
  }

  update(deltaTimeSeconds: number, framesPerSecond: number): void {
    const registry = this.getRegistry();
    this.updateBounds();
    this.sheet.update(deltaTimeSeconds);
    this.updateTransientStatus(deltaTimeSeconds);
    const player = registry.localPlayer;
    this.element('[data-testid="player-name"]').textContent = player?.displayName ?? "Player unavailable";
    this.element('[data-testid="player-health"]').textContent = player ? `${player.health} / ${player.maximumHealth}` : "—";
    const healthFraction = player && player.maximumHealth > 0 ? Math.max(0, Math.min(1, player.health / player.maximumHealth)) : 0;
    this.element(".player-health > span").style.width = `${healthFraction * 100}%`;
    const selected = registry.selectedEntity;
    this.element('[data-testid="target-name"]').textContent = selected?.displayName ?? "No target";
    this.element('[data-testid="target-health"]').textContent = selected ? `${selected.health} / ${selected.maximumHealth} HP` : "Tap a character to select";
    const despawn = this.element('[data-action="despawn"]');
    if (despawn instanceof HTMLButtonElement) despawn.disabled = !selected || selected.kind === "local-player";
    this.elapsedSeconds += deltaTimeSeconds;
    if (this.diagnosticsInitialized && this.elapsedSeconds < 0.15) return;
    this.diagnosticsInitialized = true;
    this.elapsedSeconds = 0;
    this.renderSound();
    this.renderGait();
    this.element('[data-testid="fps"]').textContent = String(Math.round(framesPerSecond));
    this.element('[data-testid="entity-count"]').textContent = String(registry.count);
    const position = registry.localPlayerPosition;
    this.element('[data-testid="coordinates"]').textContent = position ? `${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)} ${this.environment.coordinateUnit}`.trim() : "Player unavailable";
  }

  dispose(): void {
    this.events.abort(); this.resizeObserver?.disconnect();
    this.sheet.dispose(); this.root.remove(); this.labels.remove(); this.stylesheet.remove();
  }
}
