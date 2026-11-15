import { describe, expect, expectTypeOf, it } from "vitest";
import type { WorldEvent } from "../../src/world/worldTypes";
import { listTypeScriptModules, readSourceImports } from "../support/sourceImportSpecifiers";

const displayCopySpecifierFragments = ["scripts/", "native_catalog", "weapongrp", "armorgrp", "skillgrp"];
const presentationModules = [...listTypeScriptModules("src/ui"), ...listTypeScriptModules("src/runtime")];

type SkillCastEvent = Extract<WorldEvent, { type: "skill-cast" }>;

describe("server boundary invariants", () => {
  it("scans the ui and runtime modules", () => {
    expect(presentationModules).toContain("src/ui/nativeLocomotionControls.ts");
    expect(presentationModules).toContain("src/runtime/createNativeSliceRuntime.ts");
  });

  it("never imports a decoded display-copy table or a pipeline script into ui or runtime code", () => {
    const displayCopyImports = presentationModules.flatMap(modulePath => readSourceImports(modulePath)
      .filter(sourceImport => displayCopySpecifierFragments.some(fragment => sourceImport.specifier.includes(fragment)))
      .map(sourceImport => `${modulePath} -> ${sourceImport.specifier}`));
    expect(displayCopyImports).toEqual([]);
  });

  it("carries only the cast identity on a skill-cast event, no client-computed outcome", () => {
    expectTypeOf<keyof SkillCastEvent>().toEqualTypeOf<"type" | "casterId" | "skillId" | "level" | "targetId">();
    expectTypeOf<SkillCastEvent>().toEqualTypeOf<{
      readonly type: "skill-cast";
      readonly casterId: string;
      readonly skillId: number;
      readonly level: number;
      readonly targetId?: string;
    }>();
  });
});
