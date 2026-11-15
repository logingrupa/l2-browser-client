import { skillCatalogKey } from "../../assets/native/nativeCatalogIndex";
import type { NativeTableNameEntry } from "../nativeTables/readNativeTableNameIndex";
import {
  attachSandboxNameSearch, createSandboxResultNote, lastLookupVariable, outcomeOfLookup, startPickerLifetime, submittedInteger,
} from "./sandboxPickerControls";
import type { SandboxPickerFactory } from "./sandboxPickerRegistry";

const skillNameTable = "skillname-e";
const minimumSkillLevel = 1;

interface SkillIdentity { readonly skillId: number; readonly level: number }

function skillOfEntry(entry: NativeTableNameEntry): SkillIdentity | null {
  const [skillId, level] = entry.identifiers;
  if (entry.identifiers.length !== 2 || skillId === undefined || level === undefined || level < minimumSkillLevel) return null;
  return { skillId, level };
}

export const castPicker: SandboxPickerFactory = {
  id: "cast",
  title: "Cast",
  attach(group, context) {
    const lifetime = startPickerLifetime(group);
    const result = createSandboxResultNote(group, lifetime, "sandbox-cast-note");
    const castSkill = ({ skillId, level }: SkillIdentity) => {
      const targetId = context.selectedEntityId();
      context.host.dispatch({ type: "cast-skill", skillId, level, ...(targetId === null ? {} : { targetId }) });
      result.show(outcomeOfLookup(context.catalogIndex.lookup(skillCatalogKey(skillId, level))));
    };
    const hint = "Dispatches cast-skill through the sandbox host on the selected entity. Each skill row is one id and level with its catalog status.";
    const search = attachSandboxNameSearch({
      group, context, lifetime, tableId: skillNameTable, variablePrefix: "sandbox.cast", label: "Find skill", testId: "sandbox-cast-search",
      hint, pickText: "Cast selected skill", catalogKeyValues: "skill:<id>:<level> | none",
      catalogKeyOf: entry => { const skill = skillOfEntry(entry); return skill === null ? null : skillCatalogKey(skill.skillId, skill.level); },
      onPick: entry => { const skill = skillOfEntry(entry); if (skill !== null) castSkill(skill); },
      extraVariables: () => [
        { name: "sandbox.cast.target", value: () => context.selectedEntityId() ?? "none", values: "selected entity id | none",
          source: "entity registry selection", status: "presentation" },
        lastLookupVariable("sandbox.cast", result, "skill:<id>:<level> converted | gap: <reason> | not in catalog[: <reason>] | none"),
      ],
    });
    group.idEntry({
      label: "Cast skill by ID", testId: "sandbox-cast-skill", submitText: "Cast", hint, variables: search.variables,
      fields: [{ name: "skillId", label: "Skill ID", kind: "integer", minimum: 0 }, { name: "level", label: "Level", kind: "integer", minimum: minimumSkillLevel }],
      onSubmit: values => { if (lifetime.active()) castSkill({ skillId: submittedInteger(values, "skillId"), level: submittedInteger(values, "level") }); },
    });
    return lifetime.release;
  },
};
