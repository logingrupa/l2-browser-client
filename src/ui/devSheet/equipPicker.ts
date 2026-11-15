import { itemCatalogKey } from "../../assets/native/nativeCatalogIndex";
import { equipmentSlotForBodyPart, isEquipmentSlot } from "../../world/sandboxCommands";
import type { EquipmentSlot } from "../../world/worldTypes";
import type { NativeTableNameEntry } from "../nativeTables/readNativeTableNameIndex";
import {
  attachSandboxNameSearch, createSandboxResultNote, lastLookupVariable, outcomeOfLookup, startPickerLifetime, submittedInteger,
} from "./sandboxPickerControls";
import type { SandboxPickerFactory } from "./sandboxPickerRegistry";

const itemNameTable = "itemname-e";
const upperEquipmentSlot: EquipmentSlot = "upper";

function itemIdOfEntry(entry: NativeTableNameEntry): number | null {
  const [itemId] = entry.identifiers;
  return entry.identifiers.length === 1 && itemId !== undefined ? itemId : null;
}

function slotOption(slot: EquipmentSlot) {
  return { value: slot, label: slot };
}

export const equipPicker: SandboxPickerFactory = {
  id: "equip",
  title: "Equip",
  attach(group, context) {
    const lifetime = startPickerLifetime(group);
    const result = createSandboxResultNote(group, lifetime, "sandbox-equip-note");
    const slotChoice = group.choice({ label: "Slot", testId: "sandbox-equip-slot", options: [slotOption(upperEquipmentSlot)], value: upperEquipmentSlot });
    const bodyPartEntry = group.idEntry({
      label: "Body part slot", testId: "sandbox-equip-body-part", submitText: "Use slot",
      hint: "Builds the slot for a decoded body_part value through equipmentSlotForBodyPart. The meaning of each body_part value is not decoded.",
      fields: [{ name: "bodyPart", label: "body_part value", kind: "integer", minimum: 0 }],
      onSubmit: values => {
        if (!lifetime.active()) return;
        const bodyPart = submittedInteger(values, "bodyPart");
        const bodyPartSlot = equipmentSlotForBodyPart(bodyPart);
        if (bodyPartSlot === null) { bodyPartEntry.setMessage(`body_part ${bodyPart} gives no equipment slot.`); return; }
        slotChoice.setOptions([slotOption(upperEquipmentSlot), slotOption(bodyPartSlot)]);
        slotChoice.set(bodyPartSlot);
      },
    });
    const equipItem = (itemId: number) => {
      const slot = slotChoice.value;
      if (!isEquipmentSlot(slot)) { result.show({ tone: "warning", text: `${slot} is not an equipment slot; nothing was dispatched.` }); return; }
      context.host.dispatch({ type: "equip-item", slot, itemId });
      result.show(outcomeOfLookup(context.catalogIndex.lookup(itemCatalogKey(itemId))));
    };
    const hint = "Dispatches equip-item for the local player through the sandbox host into the chosen slot. Each item shows its catalog status.";
    const search = attachSandboxNameSearch({
      group, context, lifetime, tableId: itemNameTable, variablePrefix: "sandbox.equip", label: "Find item", testId: "sandbox-equip-search",
      hint, pickText: "Equip selected item", catalogKeyValues: "item:<id> | none",
      catalogKeyOf: entry => { const itemId = itemIdOfEntry(entry); return itemId === null ? null : itemCatalogKey(itemId); },
      onPick: entry => { const itemId = itemIdOfEntry(entry); if (itemId !== null) equipItem(itemId); },
      extraVariables: () => [
        { name: "sandbox.equip.slot", value: () => slotChoice.value, values: "upper | the slot equipmentSlotForBodyPart builds",
          source: "02-41 slot form; body_part meaning undecoded", status: "unverified" },
        lastLookupVariable("sandbox.equip", result, "item:<id> converted | gap: <reason> | not in catalog[: <reason>] | none"),
      ],
    });
    group.idEntry({
      label: "Equip item by ID", testId: "sandbox-equip-item", submitText: "Equip", hint, variables: search.variables,
      fields: [{ name: "itemId", label: "Item ID", kind: "integer", minimum: 0 }],
      onSubmit: values => { if (lifetime.active()) equipItem(submittedInteger(values, "itemId")); },
    });
    return lifetime.release;
  },
};
