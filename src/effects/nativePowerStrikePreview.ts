import type { WorldCommand } from "../world/worldTypes";

interface EffectToggle {
  setEnabled(value: boolean): Promise<void>;
  snapshot(): { enabled: boolean; status: string; error: string | null };
}
export interface PowerStrikeSelection {
  readonly id: string;
  readonly name: string;
  readonly rootUniqueId: number;
  isValid(): boolean;
}

/** Preparation owns no gameplay clock. Dispatch happens once, only after both
 * visual stages are ready and the user's selected target still matches. */
export function createNativePowerStrikePreview(init: EffectToggle, shot: EffectToggle,
  selected: () => PowerStrikeSelection | null, casterAlive: () => boolean,
  clearManual: () => Promise<void>, dispatch: (targetId: string) => void,
  subscribeCommands: (listener: (command: WorldCommand) => void) => () => void) {
  let disposed = false, pending = false, generation = 0, ownDispatch = false, requested = 0;
  let target: PowerStrikeSelection | null = null, error: string | null = null;
  let priorInit = false, priorShot = false;
  const listeners = new Set<() => void>();
  const publish = () => { for (const listener of listeners) listener(); };
  const cancel = (reason: string) => {
    if (!pending) return;
    generation++; pending = false; error = reason;
    if (!priorInit) void init.setEnabled(false);
    if (!priorShot) void shot.setEnabled(false);
    publish();
  };
  const unsubscribe = subscribeCommands(command => {
    if (!pending || ownDispatch) return;
    if (command.type === "move-local" || command.type === "teleport-local" || command.type === "preview-action" ||
      command.type === "set-animation" && (command.entityId === undefined || command.entityId === "local-player") ||
      command.type === "despawn" && command.entityId === target?.id ||
      command.type === "set-health" && command.health <= 0 && (command.entityId === "local-player" || command.entityId === target?.id)) {
      cancel("Preparation cancelled by a newer action.");
    }
  });
  const stop = () => {
    cancel("Preview stopped."); generation++; pending = false; target = null; error = null;
    void init.setEnabled(false); void shot.setEnabled(false); publish();
  };
  return {
    async start() {
      if (disposed || pending) return;
      const choice = selected();
      if (!casterAlive() || !choice?.isValid()) { error = "Select the living Greater Musveren before starting this preview."; publish(); return; }
      const token = ++generation; target = choice; error = null; pending = true;
      priorInit = init.snapshot().enabled; priorShot = shot.snapshot().enabled; publish();
      try {
        await clearManual();
        if (disposed || token !== generation) return;
        await init.setEnabled(true);
        if (disposed || token !== generation) return;
        if (!init.snapshot().enabled || init.snapshot().status === "loading") throw new Error(init.snapshot().error ?? "Init effects are not ready.");
        await shot.setEnabled(true);
        if (disposed || token !== generation) return;
        if (!shot.snapshot().enabled || shot.snapshot().status === "loading") throw new Error(shot.snapshot().error ?? "Shot effects are not ready.");
        const latest = selected();
        if (!casterAlive() || !choice.isValid() || !latest?.isValid() || latest.id !== choice.id || latest.rootUniqueId !== choice.rootUniqueId) {
          throw new Error("The selected target changed during preparation. Select it and try again.");
        }
        pending = false; ownDispatch = true;
        try { dispatch(choice.id); requested++; }
        finally { ownDispatch = false; }
        publish();
      } catch (failure) {
        if (!disposed && token === generation) {
          pending = false; error = failure instanceof Error ? failure.message : "Power Strike preview could not be prepared.";
          if (!priorInit) void init.setEnabled(false);
          if (!priorShot) void shot.setEnabled(false);
          publish();
        }
      }
    },
    stop,
    cancel,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot() { return { pending, disposed, targetId: target?.id ?? null, targetName: target?.name ?? null,
      error, requested, damageDispatched: false, additionalSoundSelected: false }; },
    dispose() { if (disposed) return; stop(); disposed = true; unsubscribe(); publish(); listeners.clear(); },
  };
}
export type NativePowerStrikePreview = ReturnType<typeof createNativePowerStrikePreview>;
