import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import type { NativeCatalogLookup } from "../../src/assets/native/nativeCatalogIndex";
import { buildCastSkillIndex } from "../../src/effects/castSkillIndex";
import { createSkillCastPresentation, type SkillCastEvent, type SkillCastInspection } from "../../src/effects/skillCastPresentation";
import type { DevSheet } from "../../src/ui/devSheet/DevSheet";
import { installMiniDom, type MiniDom } from "./support/miniDom";
import { attachSandboxSheetWithFakes, fakeCatalogIndexOver, type SandboxSkillCastFake } from "./support/sandboxCommandSheetFakes";

const beamGap = "emitter-class-unported:Engine.BeamEmitter";
const skillLookups = new Map<string, NativeCatalogLookup>([
  ["skill:7:2", { status: "converted", key: "skill:7:2", namedGaps: [beamGap],
    record: { skillId: 7, level: 2, effectComponentId: "interlude:skill:7:level:2:native-description-action" } }],
  ["skill:3:1", { status: "converted", key: "skill:3:1", namedGaps: [],
    record: { skillId: 3, level: 1, effectComponentId: "interlude:skill:3:level:1:raw-source-dispatch" } }],
  ["skill:7:1", { status: "gap", key: "skill:7:1", reason: "native-skill-dispatch-required", coverageStatus: "gap" }],
]);
const skillIndex = fakeCatalogIndexOver(skillLookups);

let dom: MiniDom;
const releases: (() => void)[] = [];
const openSheets: DevSheet[] = [];

beforeEach(() => { dom = installMiniDom(); });
afterEach(() => {
  for (const release of releases.splice(0).reverse()) release();
  for (const sheet of openSheets.splice(0)) sheet.dispose();
  dom.restore();
});

function inspectionOf(event: SkillCastEvent, patch: Partial<SkillCastInspection> = {}): SkillCastInspection {
  return { key: `skill:${event.skillId}:${event.level}`, casterId: event.casterId, targetId: event.targetId ?? null, catalogStatus: "converted",
    reason: null, emitterActors: 1, placements: [], notDrawn: [], featureGaps: [], namedGaps: [], ...patch };
}

function attachWithSkillCast(skillCast: SandboxSkillCastFake | null, skillCastFailure: string | null = null) {
  const attached = attachSandboxSheetWithFakes(dom, { index: skillIndex, skillCast, skillCastFailure });
  openSheets.push(attached.sheet);
  return attached;
}

async function settle() {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

describe("sandbox skill-cast wiring", () => {
  it("presents a skill-cast of a converted key other than 3:1 once, from the local player at the selected target, and notes its inspection", async () => {
    const present = vi.fn(async (event: SkillCastEvent) => inspectionOf(event, {
      namedGaps: [beamGap], featureGaps: ["mesh-emitter-lighting"],
      notDrawn: [{ object: "lineageeffect.beam_a", reason: beamGap }],
      placements: [{ actorObject: "lineageeffect.s_a", side: "caster", sourceStage: "CastingActions", unappliedFields: ["AttachOn", "bRelativeToCylinder"] }],
    }));
    const { emit, note } = attachWithSkillCast({ present });
    emit({ type: "skill-cast", casterId: "local-player", skillId: 7, level: 2, targetId: "native-musveren" });
    await settle();
    expect(present).toHaveBeenCalledOnce();
    expect(present).toHaveBeenCalledWith({ type: "skill-cast", casterId: "local-player", skillId: 7, level: 2, targetId: "native-musveren" });
    expect(note("sandbox-skill-cast-note")).toHaveLength(1);
    expect(note("sandbox-skill-cast-note")[0]!.textContent).toBe(
      "skill:7:2 converted, local-player at native-musveren | emitter actors 1 | feature gaps: mesh-emitter-lighting | " +
      `named gaps: ${beamGap} | not drawn: lineageeffect.beam_a (${beamGap}) | placement gaps: lineageeffect.s_a caster AttachOn, bRelativeToCylinder`);
    expect(note("sandbox-skill-cast-note")[0]!.dataset.tone).toBe("warning");
  });

  it("notes a fully drawn cast without gaps as info and a cast without a target as from the caster only", async () => {
    const { emit, note } = attachWithSkillCast({ present: async event => inspectionOf(event) });
    emit({ type: "skill-cast", casterId: "local-player", skillId: 7, level: 2 });
    await settle();
    expect(note("sandbox-skill-cast-note")[0]!.textContent).toBe(
      "skill:7:2 converted, local-player | emitter actors 1 | feature gaps: none | named gaps: none | not drawn: none | placement gaps: none");
    expect(note("sandbox-skill-cast-note")[0]!.dataset.tone).toBe("info");
  });

  it("sends 3:1 through the same presentation path", async () => {
    const present = vi.fn(async (event: SkillCastEvent) => inspectionOf(event, { emitterActors: 0, notDrawn: [{ object: "lineageeffect.s_u002_a", reason: "skill-effect-placement-unresolved" }] }));
    const { emit, note } = attachWithSkillCast({ present });
    emit({ type: "skill-cast", casterId: "local-player", skillId: 3, level: 1, targetId: "native-musveren" });
    await settle();
    expect(present).toHaveBeenCalledWith({ type: "skill-cast", casterId: "local-player", skillId: 3, level: 1, targetId: "native-musveren" });
    expect(note("sandbox-skill-cast-note")[0]!.textContent).toContain("not drawn: lineageeffect.s_u002_a (skill-effect-placement-unresolved)");
  });

  it("presents nothing for a key that is not in the catalog and notes its catalog reason", async () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    releases.push(() => { scene.dispose(); engine.dispose(); });
    const nodesBefore = scene.transformNodes.length;
    const presentation = createSkillCastPresentation({ scene, catalogIndex: skillIndex, castSkillIndex: buildCastSkillIndex([]),
      anchors: () => { throw new Error("a key that is not converted asks for no anchor"); }, signal: new AbortController().signal });
    releases.push(() => presentation.dispose());
    const { emit, note } = attachWithSkillCast(presentation);
    emit({ type: "skill-cast", casterId: "local-player", skillId: 999999, level: 1, targetId: "native-musveren" });
    emit({ type: "skill-cast", casterId: "local-player", skillId: 7, level: 1 });
    await settle();
    expect(scene.transformNodes).toHaveLength(nodesBefore);
    expect(note("sandbox-skill-cast-note")).toHaveLength(1);
    expect(note("sandbox-skill-cast-note")[0]!.textContent).toBe("skill:7:1 gap: native-skill-dispatch-required");
    expect(note("sandbox-skill-cast-note")[0]!.dataset.tone).toBe("warning");
  });

  it("keeps the note of the newest cast when an older presentation settles later", async () => {
    let settleFirst: ((inspection: SkillCastInspection) => void) | null = null;
    const present = vi.fn((event: SkillCastEvent) => event.skillId === 3
      ? new Promise<SkillCastInspection>(resolve => { settleFirst = resolve; })
      : Promise.resolve(inspectionOf(event)));
    const { emit, note } = attachWithSkillCast({ present });
    emit({ type: "skill-cast", casterId: "local-player", skillId: 3, level: 1 });
    emit({ type: "skill-cast", casterId: "local-player", skillId: 7, level: 2 });
    await settle();
    settleFirst!(inspectionOf({ type: "skill-cast", casterId: "local-player", skillId: 3, level: 1 }, { reason: "skill-cast-superseded", emitterActors: 0 }));
    await settle();
    expect(note("sandbox-skill-cast-note")).toHaveLength(1);
    expect(note("sandbox-skill-cast-note")[0]!.textContent).toMatch(/^skill:7:2 converted/);
  });

  it("notes a presentation failure with its message", async () => {
    const { emit, note } = attachWithSkillCast({ present: async () => { throw new Error("Effect resource returned HTTP 404."); } });
    emit({ type: "skill-cast", casterId: "local-player", skillId: 7, level: 2 });
    await settle();
    expect(note("sandbox-skill-cast-note")[0]!.textContent).toBe("skill:7:2 presentation failed: Effect resource returned HTTP 404.");
    expect(note("sandbox-skill-cast-note")[0]!.dataset.tone).toBe("warning");
  });

  it("notes why no presentation exists when the cast skill index could not be built", async () => {
    const { emit, note } = attachWithSkillCast(null, "Cast skill index: skill:7:2 has two effect component records, a and b.");
    emit({ type: "skill-cast", casterId: "local-player", skillId: 7, level: 2 });
    await settle();
    expect(note("sandbox-skill-cast-note")[0]!.textContent)
      .toBe("skill:7:2 not presented: Cast skill index: skill:7:2 has two effect component records, a and b.");
  });

  it("presents nothing and writes no note after release", async () => {
    const present = vi.fn(async (event: SkillCastEvent) => inspectionOf(event));
    const { emit, note, release } = attachWithSkillCast({ present });
    release();
    emit({ type: "skill-cast", casterId: "local-player", skillId: 7, level: 2 });
    await settle();
    expect(present).not.toHaveBeenCalled();
    expect(note("sandbox-skill-cast-note")).toHaveLength(0);
  });
});
