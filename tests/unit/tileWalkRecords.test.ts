import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTileWalkOutcome, requestedWalkTileIds, settleViewportWalk, tileWalkRecordFilePath } from "../browser/support/tileWalkRecords";

describe("requestedWalkTileIds", () => {
  it("walks 20_21 when WALK_TILE_IDS is unset", () => {
    expect(requestedWalkTileIds(undefined)).toEqual(["20_21"]);
  });

  it("reads a comma list of XX_YY ids in order", () => {
    expect(requestedWalkTileIds("17_12, 20_21,15_20")).toEqual(["17_12", "20_21", "15_20"]);
  });

  it("refuses an empty entry", () => {
    expect(() => requestedWalkTileIds("20_21,,17_12")).toThrow("WALK_TILE_IDS \"20_21,,17_12\" holds an empty entry");
    expect(() => requestedWalkTileIds("")).toThrow("holds an empty entry");
  });

  it("refuses an id that is not XX_YY", () => {
    expect(() => requestedWalkTileIds("20_21,tile:17_12")).toThrow("WALK_TILE_IDS entry \"tile:17_12\" is not an XX_YY tile id");
    expect(() => requestedWalkTileIds("2_21")).toThrow("is not an XX_YY tile id");
  });

  it("refuses a repeated id", () => {
    expect(() => requestedWalkTileIds("20_21,17_12,20_21")).toThrow("WALK_TILE_IDS repeats 20_21");
  });
});

describe("tileWalkRecordFilePath", () => {
  it("places the walk records beside the other lane measurements under the catalog SHA-256", () => {
    const catalogSha256 = "c".repeat(64);
    expect(tileWalkRecordFilePath("/project", "world", catalogSha256))
      .toBe(resolve("/project", "artifacts/lane-store/world/measurements", `tile-walks-${catalogSha256}.json`));
  });
});

describe("settleViewportWalk", () => {
  it("settles a pass only when every viewport walk passed", () => {
    const outcome = createTileWalkOutcome(2);
    expect(settleViewportWalk(outcome, null)).toBeNull();
    expect(settleViewportWalk(outcome, null)).toEqual({ status: "pass", reason: null });
  });

  it("settles a failure with the first failure line as soon as one viewport fails", () => {
    const outcome = createTileWalkOutcome(2);
    expect(settleViewportWalk(outcome, null)).toBeNull();
    expect(settleViewportWalk(outcome, "tile:17_12 did not start on the native route")).toEqual({ status: "failed", reason: "tile:17_12 did not start on the native route" });
  });

  it("keeps the first failure line of a tile when a later viewport fails too", () => {
    const outcome = createTileWalkOutcome(2);
    expect(settleViewportWalk(outcome, "first failure")).toEqual({ status: "failed", reason: "first failure" });
    expect(settleViewportWalk(outcome, "second failure")).toEqual({ status: "failed", reason: "first failure" });
  });

  it("keeps one outcome per tile", () => {
    const failedTile = createTileWalkOutcome(2);
    const passingTile = createTileWalkOutcome(2);
    settleViewportWalk(failedTile, "failed tile");
    expect(settleViewportWalk(passingTile, null)).toBeNull();
    expect(settleViewportWalk(passingTile, null)).toEqual({ status: "pass", reason: null });
  });
});
