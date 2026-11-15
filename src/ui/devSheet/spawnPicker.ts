import {
  characterCatalogKey, describeNativeCatalogLookup, npcCatalogKey, tableCatalogKey, type NativeCatalogLookup,
} from "../../assets/native/nativeCatalogIndex";
import type { NativeTableNameEntry } from "../nativeTables/readNativeTableNameIndex";
import {
  attachSandboxNameSearch, createSandboxResultNote, lastLookupVariable, outcomeOfLookup, sandboxCatalogIndexSource, startPickerLifetime, submittedInteger,
} from "./sandboxPickerControls";
import type { SandboxPickerFactory } from "./sandboxPickerRegistry";

const npcNameTable = "npcname-e";
const characterTemplateTable = "chargrp";

function npcIdOfEntry(entry: NativeTableNameEntry): number | null {
  const [npcId] = entry.identifiers;
  return entry.identifiers.length === 1 && npcId !== undefined ? npcId : null;
}

function characterTemplateCount(chargrpLookup: NativeCatalogLookup): number | null {
  if (chargrpLookup.status !== "converted" || !("recordCount" in chargrpLookup.record)) return null;
  return chargrpLookup.record.recordCount;
}

export const spawnPicker: SandboxPickerFactory = {
  id: "spawn",
  title: "Spawn",
  attach(group, context) {
    const lifetime = startPickerLifetime(group);
    const result = createSandboxResultNote(group, lifetime, "sandbox-spawn-note");
    const chargrpLookup = () => context.catalogIndex.lookup(tableCatalogKey(characterTemplateTable));
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
      extraVariables: () => [
        lastLookupVariable("sandbox.spawn", result, "npc:<id> | character:<index> converted | gap: <reason> | not in catalog[: <reason>] | none"),
        { name: "sandbox.spawn.characterTemplateCount", value: () => String(characterTemplateCount(chargrpLookup()) ?? describeNativeCatalogLookup(chargrpLookup())),
          values: "recordCount of table:chargrp | its catalog status when not converted", source: sandboxCatalogIndexSource, status: "native" },
      ],
    });
    group.idEntry({
      label: "Spawn NPC by ID", testId: "sandbox-spawn-npc", submitText: "Spawn", hint, variables: search.variables,
      fields: [{ name: "npcId", label: "NPC ID", kind: "integer", minimum: 0 }],
      onSubmit: values => { if (lifetime.active()) spawnNpc(submittedInteger(values, "npcId")); },
    });
    const characterEntry = group.idEntry({
      label: "Spawn character", testId: "sandbox-spawn-character", submitText: "Spawn", variables: search.variables,
      hint: "Dispatches spawn-character with a chargrp template index. A converted table:chargrp bounds the index by its record count.",
      fields: [{ name: "characterTemplateIndex", label: "Chargrp index", kind: "integer", minimum: 0 }],
      onSubmit: values => {
        if (!lifetime.active()) return;
        const characterTemplateIndex = submittedInteger(values, "characterTemplateIndex");
        const tableLookup = chargrpLookup(), templateCount = characterTemplateCount(tableLookup);
        if (templateCount !== null && characterTemplateIndex >= templateCount) {
          characterEntry.setMessage(`Chargrp index must be below ${templateCount}, the ${tableLookup.key} record count.`);
          return;
        }
        context.host.dispatch({ type: "spawn-character", characterTemplateIndex });
        const outcome = outcomeOfLookup(context.catalogIndex.lookup(characterCatalogKey(characterTemplateIndex)));
        result.show(templateCount === null ? { tone: "warning", text: `${outcome.text}; unbounded because ${describeNativeCatalogLookup(tableLookup)}` } : outcome);
      },
    });
    return lifetime.release;
  },
};
