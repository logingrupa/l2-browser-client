import { npcCatalogKey } from "../../assets/native/nativeCatalogIndex";
import type { NativeTableNameEntry } from "../nativeTables/readNativeTableNameIndex";
import {
  attachSandboxNameSearch, createSandboxResultNote, lastLookupVariable, outcomeOfLookup, startPickerLifetime, submittedInteger,
} from "./sandboxPickerControls";
import type { SandboxPickerFactory } from "./sandboxPickerRegistry";

const npcNameTable = "npcname-e";

function npcIdOfEntry(entry: NativeTableNameEntry): number | null {
  const [npcId] = entry.identifiers;
  return entry.identifiers.length === 1 && npcId !== undefined ? npcId : null;
}

export const spawnPicker: SandboxPickerFactory = {
  id: "spawn",
  title: "Spawn",
  attach(group, context) {
    const lifetime = startPickerLifetime(group);
    const result = createSandboxResultNote(group, lifetime, "sandbox-spawn-note");
    const spawnNpc = (npcId: number) => {
      context.host.dispatch({ type: "spawn-npc", npcId });
      result.show(outcomeOfLookup(context.catalogIndex.lookup(npcCatalogKey(npcId))));
    };
    const hint = "Dispatches spawn-npc through the sandbox host. Each match shows its catalog status; an NPC without a converted model still spawns as a marker.";
    const search = attachSandboxNameSearch({
      group, context, lifetime, tableId: npcNameTable, variablePrefix: "sandbox.spawn", label: "Find NPC", testId: "sandbox-spawn-search",
      hint, pickText: "Spawn selected NPC", catalogKeyValues: "npc:<id> | none",
      catalogKeyOf: entry => { const npcId = npcIdOfEntry(entry); return npcId === null ? null : npcCatalogKey(npcId); },
      onPick: entry => { const npcId = npcIdOfEntry(entry); if (npcId !== null) spawnNpc(npcId); },
      extraVariables: () => [lastLookupVariable("sandbox.spawn", result, "npc:<id> converted | gap: <reason> | not in catalog[: <reason>] | none")],
    });
    group.idEntry({
      label: "Spawn NPC by ID", testId: "sandbox-spawn-npc", submitText: "Spawn", hint, variables: search.variables,
      fields: [{ name: "npcId", label: "NPC ID", kind: "integer", minimum: 0 }],
      onSubmit: values => { if (lifetime.active()) spawnNpc(submittedInteger(values, "npcId")); },
    });
    return lifetime.release;
  },
};
