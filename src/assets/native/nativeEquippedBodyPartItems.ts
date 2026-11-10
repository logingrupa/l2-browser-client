import type { Scene } from "@babylonjs/core/scene";
import type { BodyPartEquipmentSlot, WorldEntity } from "../../world/worldTypes";
import { isEquipmentSlot } from "../../world/sandboxCommands";
import { NativeActor, type NativeBoneAnchor, type NativeBoneAnchorInspection } from "./NativeActor";
import type { NativeCatalogLookup } from "./nativeCatalogIndex";
import type { EquippedItemPresentation } from "./nativeEquippedItemPresentation";
import type { NativeEquippedItemSource } from "./nativeEquippedItemSource";

export type EquippedItemPresenter = (slot: BodyPartEquipmentSlot, lookup: NativeCatalogLookup) => EquippedItemPresentation;

interface BodyPartItemPresentationState {
  diagnostic: string | null;
  anchor: NativeBoneAnchor | null;
  model: NativeActor | null;
}

interface EquippedBodyPartItem extends BodyPartItemPresentationState {
  readonly itemId: number;
  readonly request: AbortController;
}

function isBodyPartSlot(slot: string): slot is BodyPartEquipmentSlot {
  return slot !== "upper" && isEquipmentSlot(slot);
}

function equippedBodyPartItemIds(equipment: WorldEntity["equipment"]): ReadonlyMap<BodyPartEquipmentSlot, number> {
  const itemIds = new Map<BodyPartEquipmentSlot, number>();
  for (const [slot, itemId] of Object.entries(equipment ?? {})) if (isBodyPartSlot(slot) && itemId !== undefined) itemIds.set(slot, itemId);
  return itemIds;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "could not be presented";
}

export class NativeEquippedBodyPartItems {
  private readonly items = new Map<BodyPartEquipmentSlot, EquippedBodyPartItem>();
  private canonicalSlotOrder: readonly BodyPartEquipmentSlot[] = [];

  constructor(private readonly scene: Scene, private readonly source: NativeEquippedItemSource, private readonly lifetime: AbortSignal,
    private readonly reportDiagnostic: (diagnostic: string) => void) {}

  update(actor: NativeActor, equipment: WorldEntity["equipment"], present: EquippedItemPresenter): void {
    const wanted = equippedBodyPartItemIds(equipment);
    this.canonicalSlotOrder = [...wanted.keys()];
    for (const [slot, item] of [...this.items]) if (wanted.get(slot) !== item.itemId) this.remove(slot);
    for (const [slot, itemId] of wanted) if (!this.items.has(slot)) this.equip(actor, slot, itemId, present);
  }

  private equip(actor: NativeActor, slot: BodyPartEquipmentSlot, itemId: number, present: EquippedItemPresenter): void {
    const request = new AbortController(), signal = AbortSignal.any([request.signal, this.lifetime]);
    const state: BodyPartItemPresentationState = { diagnostic: null, anchor: null, model: null };
    this.items.set(slot, Object.assign(state, { itemId, request }));
    void this.attach(actor, slot, itemId, present, signal, state).catch((error: unknown) => {
      if (!signal.aborted) this.recordDiagnostic(state, `item:${itemId} ${errorText(error)}`);
    });
  }

  private recordDiagnostic(state: BodyPartItemPresentationState, diagnostic: string): void {
    state.diagnostic = diagnostic;
    this.reportDiagnostic(diagnostic);
  }

  private async attach(actor: NativeActor, slot: BodyPartEquipmentSlot, itemId: number, present: EquippedItemPresenter, signal: AbortSignal,
    state: BodyPartItemPresentationState): Promise<void> {
    const presentation = present(slot, await this.source.lookup(itemId, signal));
    signal.throwIfAborted();
    if (presentation.kind === "gap") { this.recordDiagnostic(state, presentation.reason); return; }
    const asset = await this.source.loadModel(presentation.catalogId, signal);
    const model = await NativeActor.create(this.scene, asset, signal);
    try {
      signal.throwIfAborted();
      const anchor = actor.createBoneAnchor(presentation.sourceObject, presentation.boneName);
      for (const mesh of model.ownedMeshes()) mesh.isPickable = false;
      model.root.parent = anchor.root;
      state.anchor = anchor; state.model = model;
    } catch (error) { model.dispose(); throw error; }
  }

  private remove(slot: BodyPartEquipmentSlot): void {
    const item = this.items.get(slot);
    if (!item) return;
    this.items.delete(slot);
    item.request.abort();
    item.model?.dispose(); item.anchor?.dispose();
  }

  get diagnostic(): string | null {
    const diagnostics = this.canonicalSlotOrder.flatMap(slot => {
      const diagnostic = this.items.get(slot)?.diagnostic;
      return diagnostic ? [diagnostic] : [];
    });
    return diagnostics.length ? diagnostics.join("; ") : null;
  }

  anchorSnapshots(): readonly (NativeBoneAnchorInspection & { id: string })[] {
    return this.canonicalSlotOrder.flatMap(slot => {
      const anchor = this.items.get(slot)?.anchor;
      return anchor ? [{ id: slot, ...anchor.inspection() }] : [];
    });
  }

  dispose(): void {
    for (const slot of [...this.items.keys()]) this.remove(slot);
  }
}
