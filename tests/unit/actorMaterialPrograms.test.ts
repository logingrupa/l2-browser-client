import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actorMaterialProgramsOfCatalog, actorSlotMaterialNoneReason, actorSlotMaterialUnlistedReason, parseActorMaterialProgramListing,
  readActorModelSlotSourceObjects,
} from "../../src/assets/native/actorMaterialPrograms";
import { sha256, type AssetPackage } from "../../src/assets/package/readAssetPackage";

const programSha256 = "ab".repeat(32);
const portedObject = "LineageNpcsTex.e_teleporter_FHuman.e_teleporter_FHuman_m00_t00_b00";
const unportedObject = "LineageNpcsTex.Synthetic.TriggeredOscillator";
const signal = () => new AbortController().signal;

function listing(fields: Record<string, unknown> = {}) {
  return { kind: "native-actor-material-program", schemaVersion: 1, sourceObject: portedObject,
    program: { directory: `native-materials/${programSha256}`, programSha256 }, rootPorted: true, gapReasons: [],
    files: { [`${programSha256}/program.json`]: { sha256: programSha256, bytes: 10 } }, ...fields };
}

async function servedListings(listings: readonly Record<string, unknown>[]) {
  const served = new Map<string, Uint8Array<ArrayBuffer>>(), records = [];
  for (const value of listings) {
    const bytes = new TextEncoder().encode(JSON.stringify(value)), listingSha256 = await sha256(bytes);
    const manifest = `/l2/native-materials/material-program-${listingSha256}.json`;
    served.set(manifest, bytes);
    records.push({ id: `material-program:${String(value.sourceObject)}`, manifest, manifestSha256: listingSha256, manifestBytes: bytes.length });
  }
  const fetchResource = vi.fn(async (url: string) => {
    const bytes = served.get(url);
    return bytes ? new Response(bytes.slice()) : new Response("missing", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchResource);
  return { records, served, fetchResource };
}

function assetWithProvenance(provenance: unknown): AssetPackage {
  const files = new Map<string, Uint8Array>();
  if (provenance !== undefined) files.set("provenance.json", new TextEncoder().encode(JSON.stringify(provenance)));
  return { manifest: { id: "interlude:Synthetic.Actor" } as AssetPackage["manifest"], files };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("the actor material program listing", () => {
  it("parses a ported program and an unported root with its reasons", () => {
    expect(parseActorMaterialProgramListing(listing(), portedObject)).toEqual({ sourceObject: portedObject, programMaterialId: programSha256, rootPorted: true, gapReasons: [] });
    expect(parseActorMaterialProgramListing(listing({ sourceObject: unportedObject, rootPorted: false, gapReasons: ["material-class-unported:Engine.TexOscillatorTriggered"] }), unportedObject))
      .toMatchObject({ rootPorted: false, gapReasons: ["material-class-unported:Engine.TexOscillatorTriggered"] });
  });

  it.each([
    ["another source object", listing(), unportedObject, "names source object"],
    ["an unported root without a gap reason", listing({ rootPorted: false }), portedObject, "unported root without a gap reason"],
    ["a ported root without a program", listing({ program: null }), portedObject, "ported root without a program"],
    ["a program pin naming another directory", listing({ program: { directory: "native-materials/other", programSha256 } }), portedObject, "no native-materials program pin"],
    ["an extra field", listing({ extra: true }), portedObject, "holding exactly"],
  ])("refuses %s", (_description, value, expected, message) => {
    expect(() => parseActorMaterialProgramListing(value, expected)).toThrow(message);
  });
});

describe("the slot to program join of the materialPrograms catalog slice", () => {
  it("joins an object whose UE2 name holds an apostrophe", async () => {
    const apostrophe = "LineageWeaponsTex.knife_o'_silenus.knife_o'_silenus_t00_wp";
    const { records } = await servedListings([listing({ sourceObject: apostrophe })]);
    expect(await actorMaterialProgramsOfCatalog({ materialPrograms: records }).joinSlot(apostrophe, signal()))
      .toEqual({ kind: "program", sourceObject: apostrophe, programMaterialId: programSha256 });
  });

  it("joins a slot object to its ported program without regard to case and fetches each listing once", async () => {
    const { records, fetchResource } = await servedListings([listing()]);
    const programs = actorMaterialProgramsOfCatalog({ materialPrograms: records });
    const expected = { kind: "program", sourceObject: portedObject, programMaterialId: programSha256 };
    expect(await programs.joinSlot(portedObject.toUpperCase(), signal())).toEqual(expected);
    expect(await programs.joinSlot(portedObject, signal())).toEqual(expected);
    expect(fetchResource).toHaveBeenCalledTimes(1);
  });

  it("names the gap reasons of an unported root, an unlisted object, a slot without an object and a listing that differs from its pin", async () => {
    const unported = listing({ sourceObject: unportedObject, rootPorted: false, gapReasons: ["material-class-unported:Engine.TexOscillatorTriggered"] });
    const { records, served } = await servedListings([listing(), unported]);
    served.set(records[0]!.manifest, new TextEncoder().encode("{}"));
    const programs = actorMaterialProgramsOfCatalog({ materialPrograms: records });
    expect(await programs.joinSlot(unportedObject, signal())).toEqual({ kind: "gap", sourceObject: unportedObject, reasons: ["material-class-unported:Engine.TexOscillatorTriggered"] });
    expect(await programs.joinSlot("Other.Material", signal())).toEqual({ kind: "gap", sourceObject: "Other.Material", reasons: [actorSlotMaterialUnlistedReason] });
    expect(await programs.joinSlot(null, signal())).toEqual({ kind: "gap", sourceObject: null, reasons: [actorSlotMaterialNoneReason] });
    const tampered = await programs.joinSlot(portedObject, signal());
    expect(tampered).toMatchObject({ kind: "gap", sourceObject: portedObject });
    expect(tampered.kind === "gap" && tampered.reasons[0]).toMatch(/^actor-material-program-invalid:Native resource hash\/length mismatch/);
  });

  it("refuses a catalog record that is no pinned listing and an object listed twice", async () => {
    const { records } = await servedListings([listing()]);
    expect(() => actorMaterialProgramsOfCatalog({ materialPrograms: [{ ...records[0]!, id: "material-program:NoGroup" }] })).toThrow("materialPrograms entry is invalid");
    expect(() => actorMaterialProgramsOfCatalog({ materialPrograms: [records[0]!, { ...records[0]!, id: records[0]!.id.toUpperCase().replace("MATERIAL-PROGRAM:", "material-program:") }] }))
      .toThrow("lists LINEAGENPCSTEX");
  });
});

describe("the slot source objects of an actor model package", () => {
  it("reads the object the converter resolved for each slot root, of a model and of an assembly in glTF material order", () => {
    expect(readActorModelSlotSourceObjects(assetWithProvenance({ metadata: { materialSlots: [
      { sourceReference: "Pack.Short", nativeMaterialGraph: [{ object: portedObject }], texture: "Pack.Group.Leaf" },
      { sourceReference: "Pack.Texture", texture: "Pack.Group.TextureRoot" },
      { sourceReference: "Pack.Combiner", unsupportedMaterialAdapter: { class: "Combiner", object: "pack.group.combinerroot" } },
      { binding: "unbound-source-slot" }] } })))
      .toEqual({ kind: "slots", sourceObjects: [portedObject, "Pack.Group.TextureRoot", "pack.group.combinerroot", null] });
    expect(readActorModelSlotSourceObjects(assetWithProvenance({ metadata: { parts: [{ materialSlots: [{ texture: "A.B" }] }, { materialSlots: [{ texture: "C.D" }] }] } })))
      .toEqual({ kind: "slots", sourceObjects: ["A.B", "C.D"] });
    expect(readActorModelSlotSourceObjects(assetWithProvenance({ metadata: { materialSlots: [{ texture: "LineageWeaponsTex.knife_o'_silenus.knife_o'_silenus_t00_wp" }] } })))
      .toEqual({ kind: "slots", sourceObjects: ["LineageWeaponsTex.knife_o'_silenus.knife_o'_silenus_t00_wp"] });
  });

  it("states an absent slot list and refuses a slot reference that is no object name", () => {
    expect(readActorModelSlotSourceObjects(assetWithProvenance(undefined))).toEqual({ kind: "absent" });
    expect(readActorModelSlotSourceObjects(assetWithProvenance({ metadata: {} }))).toEqual({ kind: "absent" });
    expect(() => readActorModelSlotSourceObjects(assetWithProvenance({ metadata: { materialSlots: [{ texture: "not an object" }] } }))).toThrow("no qualified object name");
  });
});
