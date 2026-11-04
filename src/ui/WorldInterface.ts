import type { EntityRegistry } from "../entities/EntityRegistry";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { WorldCommand } from "../world/worldTypes";
import { worldStyles } from "./worldStyles";

const swordIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 17 11-13 2 1-1 4L8 19M5 14l5 6M3 21l4-4"/></svg>';

export class WorldInterface {
  readonly root = document.createElement("section");
  readonly labels = document.createElement("div");
  private readonly events = new AbortController();
  private isPaused = false;
  private elapsedSeconds = 0;
  private readonly stylesheet = document.createElement("style");
  private previousBounds = "";

  constructor(private readonly adapter: GameWorldAdapter, private readonly getRegistry: () => EntityRegistry, private readonly canvas: HTMLCanvasElement) {
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
        <p class="world-message" data-testid="world-status" role="status">Entering the world…</p>
        <div class="diagnostics" aria-label="World diagnostics"><span><output data-testid="fps">0</output> FPS</span><span><output data-testid="entity-count">0</output> entities</span><output data-testid="coordinates">0.0, 0.0, 0.0</output></div>
        <div class="action-bar" role="group" aria-label="Character actions">
          <button type="button" data-action="attack" class="attack-action">${swordIcon}<span>Attack</span></button>
          <button type="button" data-action="run"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="15" cy="4" r="2"/><path d="m4 12 5-4 6 2 2 4h4M13 10l-3 6-5 4M10 16l6 2v4"/></svg><span>Run</span></button>
          <button type="button" data-action="idle"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4" r="2"/><path d="M12 7v9m-6-5 6-3 6 3m-6 5-4 6m4-6 4 6"/></svg><span>Idle</span></button>
          <button type="button" data-action="teleport"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-8 11h6l-1 9 9-12h-7Z"/></svg><span>Teleport</span></button>
          <button type="button" data-action="spawn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg><span>Spawn</span></button>
        </div>
        <details class="demo-controls"><summary>Demo controls</summary><div class="demo-controls-body">
          <div class="secondary-actions"><button type="button" data-action="pause">Pause</button><button type="button" data-action="despawn" disabled>Despawn target</button><button type="button" data-action="missing-model">Missing model</button></div>
          <p>Tap a character to target. Tap the ground to move. Drag to orbit; pinch to zoom. With a mouse, right-drag and scroll.</p>
          <p>Attack is an animation demonstration. All names, health and movement are synthetic.</p>
        </div></details>
      </div>`;
    this.labels.className = "entity-labels";
    this.labels.setAttribute("aria-label", "World characters");
    document.body.append(this.labels, this.root);
    this.updateBounds();
    this.root.addEventListener("click", (event) => this.handleClick(event), { signal: this.events.signal });
  }

  private element(selector: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing interface element: ${selector}`);
    return element;
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
      case "missing-model": command = { type: "load-missing-model" }; break;
      default: return;
    }
    this.adapter.dispatch(command);
    if (action !== "pause") this.showStatus(action === "missing-model" ? "Loading a missing model to test the fallback…" : `${button.textContent?.trim()} demonstration`);
  }

  showStatus(message: string): void { this.element('[data-testid="world-status"]').textContent = message; }

  private updateBounds(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
    if (key === this.previousBounds) return;
    this.previousBounds = key;
    for (const overlay of [this.root, this.labels]) {
      Object.assign(overlay.style, { inset: "auto", left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
    }
  }

  update(deltaTimeSeconds: number, framesPerSecond: number): void {
    const registry = this.getRegistry();
    this.updateBounds();
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
    if (this.elapsedSeconds < 0.15) return;
    this.elapsedSeconds = 0;
    this.element('[data-testid="fps"]').textContent = String(Math.round(framesPerSecond));
    this.element('[data-testid="entity-count"]').textContent = String(registry.count);
    const position = registry.localPlayerPosition;
    this.element('[data-testid="coordinates"]').textContent = position ? `${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)} m` : "Player unavailable";
  }

  dispose(): void { this.events.abort(); this.root.remove(); this.labels.remove(); this.stylesheet.remove(); }
}
