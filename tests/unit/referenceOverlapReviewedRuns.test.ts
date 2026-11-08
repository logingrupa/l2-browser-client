import { createHash } from "node:crypto";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReferenceOverlapSetupError, type ReviewedRunRow, type ReviewedRunsFile } from "../../tools/reference-overlap/referenceOverlap.mjs";
import {
  createWorkspace, generatedCoreClonePath, generatedCoreReferenceFile, generatedCoreSourceFile, lineage2jsClonePath, movementSourceDirectory,
  overlapAreasWithMovementAllowlist, removeTemporaryWorkspaces, runMovementOverlap, runOverlapCommand, sha256OfOriginalTokens,
  writeFixtureWorkspace, writeSharedCoreWorkspace,
} from "../support/referenceOverlapWorkspace";
import { alternatingCoreText, sourceAndReferenceWithSharedCore } from "../support/sharedTokenCore";

const reviewedRunFields = ["tokenCount", "sourceTokensSha256", "referenceFilesSha256", "escalated", "reason"];
const sharedCoreTokenCount = 19;
const sharedCore = sourceAndReferenceWithSharedCore(sharedCoreTokenCount);
const sharedCoreReferenceTexts = { [generatedCoreClonePath]: sharedCore.referenceText };
const sharedCoreSourceTokensSha256 = sha256OfOriginalTokens(alternatingCoreText(sharedCoreTokenCount, "alpha").split(" "));
const secondCoreReferenceFile = `${lineage2jsClonePath}/src/physics/secondCore.ts`;
const unrelatedRun: ReviewedRunRow = [12, "1".repeat(64), "2".repeat(64), true, "A synthetic run that no longer exists."];

afterEach(removeTemporaryWorkspaces);

function sha256OfReferenceFileList(referenceFiles: readonly string[]): string {
  return createHash("sha256").update(referenceFiles.join("\n")).digest("hex");
}

const sharedCoreRun: ReviewedRunRow = [sharedCoreTokenCount, sharedCoreSourceTokensSha256, sha256OfReferenceFileList([generatedCoreReferenceFile]), false, "Synthetic generic run."];

function reviewedRunsFileOf(rows: readonly ReviewedRunRow[], area = "movement", reviewedOn = "2026-11-09"): ReviewedRunsFile {
  return {
    schemaVersion: 1, area, runFields: reviewedRunFields,
    reviews: [{ reviewedOn, method: "Synthetic reviewers judged these fixture runs generic.", files: { [generatedCoreSourceFile]: rows } }],
  };
}

function decodedRow([tokenCount, sourceTokensSha256, referenceFilesSha256, escalated, reason]: ReviewedRunRow, reviewedOn = "2026-11-09") {
  return { sourceFile: generatedCoreSourceFile, tokenCount, sourceTokensSha256, referenceFilesSha256, escalated, reason, reviewedOn };
}

function sharedCoreWorkspace(sourceText = sharedCore.sourceText, referenceTexts: Readonly<Record<string, string>> = sharedCoreReferenceTexts): string {
  return writeSharedCoreWorkspace(sourceText, referenceTexts);
}

describe("reviewed reviewer runs", () => {
  it("marks a run reviewed when a row has its file, token count, token hash and reference file hash", () => {
    const report = runMovementOverlap(sharedCoreWorkspace(), { reviewedRuns: { movement: reviewedRunsFileOf([sharedCoreRun]) } });
    expect(report.reviewerRuns.map(run => [run.referenceFilesSha256, run.reviewed])).toEqual([[sha256OfReferenceFileList([generatedCoreReferenceFile]), { reviewedOn: "2026-11-09" }]]);
    expect(report.reviewedRunCount).toBe(1);
    expect(report.unreviewedRuns).toEqual([]);
    expect(report.staleReviewedRuns).toEqual([]);
  });

  it("keeps the review when the run moves to other lines", () => {
    const report = runMovementOverlap(sharedCoreWorkspace(`const moved = 1;\n\n${sharedCore.sourceText}`), { reviewedRuns: { movement: reviewedRunsFileOf([sharedCoreRun]) } });
    expect(report.reviewerRuns.map(run => [run.sourceStartLine, run.reviewed])).toEqual([[3, { reviewedOn: "2026-11-09" }]]);
  });

  it("makes the run unreviewed and the row stale after an edit inside the run", () => {
    const report = runMovementOverlap(sharedCoreWorkspace(sharedCore.sourceText.replace("alpha0", "renamed0")), { reviewedRuns: { movement: reviewedRunsFileOf([sharedCoreRun]) } });
    expect(report.reviewedRunCount).toBe(0);
    expect(report.unreviewedRuns).toEqual([{
      sourceFile: generatedCoreSourceFile, sourceStartLine: 1, sourceEndLine: 1, tokenCount: sharedCoreTokenCount,
      sourceTokensSha256: sha256OfOriginalTokens(["renamed0", ...alternatingCoreText(sharedCoreTokenCount, "alpha").split(" ").slice(1)]),
      referenceFilesSha256: sha256OfReferenceFileList([generatedCoreReferenceFile]),
      referenceMatches: [{ referenceFile: generatedCoreReferenceFile, referenceStartLine: 1, referenceEndLine: 1 }],
    }]);
    expect(report.staleReviewedRuns).toEqual([decodedRow(sharedCoreRun)]);
  });

  it("makes the run unreviewed when it also matches a new reference file", () => {
    const workspace = sharedCoreWorkspace(sharedCore.sourceText, { ...sharedCoreReferenceTexts, "src/physics/secondCore.ts": sharedCore.referenceText });
    const report = runMovementOverlap(workspace, { reviewedRuns: { movement: reviewedRunsFileOf([sharedCoreRun]) } });
    expect(report.unreviewedRuns.map(run => run.referenceFilesSha256)).toEqual([sha256OfReferenceFileList([generatedCoreReferenceFile, secondCoreReferenceFile])]);
    expect(report.staleReviewedRuns).toEqual([decodedRow(sharedCoreRun)]);
  });

  it("asks for a review of a run inside an allowlisted constant", () => {
    const report = runMovementOverlap(writeFixtureWorkspace(["replyCodeTable.ts"]), {
      overlapAreas: overlapAreasWithMovementAllowlist(`${movementSourceDirectory}/replyCodeTable.ts`, "fixtureReplyCodeTable"),
    });
    expect(report.blockingRuns).toEqual([]);
    expect(report.unreviewedRuns.map(run => run.tokenCount)).toEqual([29]);
  });

  it("reads a missing area file as zero reviewed rows and ignores other areas", () => {
    const report = runMovementOverlap(sharedCoreWorkspace(), { reviewedRuns: { particles: reviewedRunsFileOf([sharedCoreRun], "particles") } });
    expect(report.reviewedRunCount).toBe(0);
    expect(report.unreviewedRuns).toHaveLength(1);
    expect(report.staleReviewedRuns).toEqual([]);
  });

  it("accepts reviewed rows for the network area", () => {
    expect(() => runMovementOverlap(sharedCoreWorkspace(), { reviewedRuns: { network: reviewedRunsFileOf([sharedCoreRun], "network") } })).not.toThrow();
  });

  it("keeps the date of the review that produced each row", () => {
    const earlierReview = reviewedRunsFileOf([sharedCoreRun], "movement", "2026-11-08").reviews[0]!;
    const laterReview = reviewedRunsFileOf([unrelatedRun]).reviews[0]!;
    const report = runMovementOverlap(sharedCoreWorkspace(), { reviewedRuns: { movement: { ...reviewedRunsFileOf([]), reviews: [earlierReview, laterReview] } } });
    expect(report.reviewerRuns.map(run => run.reviewed)).toEqual([{ reviewedOn: "2026-11-08" }]);
    expect(report.staleReviewedRuns).toEqual([decodedRow(unrelatedRun, "2026-11-09")]);
  });
});

describe("--require-reviewed", () => {
  const reviewedRunsFileName = "movement.json";

  it("exits 0 when every reviewer run has a row and no row is stale", () => {
    const { status, stderr } = runOverlapCommand(sharedCoreWorkspace(), {
      reviewedRunsTextsByFileName: { [reviewedRunsFileName]: JSON.stringify(reviewedRunsFileOf([sharedCoreRun])) }, requireReviewed: true,
    });
    expect(status).toBe(0);
    expect(stderr).toBe("");
  });

  it("leaves the default exit code alone and exits 1 with the flag when a run has no row", () => {
    const workspace = sharedCoreWorkspace();
    expect(runOverlapCommand(workspace).status).toBe(0);
    const { status, stderr, reviewedRunsDirectory } = runOverlapCommand(workspace, { requireReviewed: true });
    expect(status).toBe(1);
    expect(stderr.trim()).toBe(`1 unreviewed reviewer run(s) and 0 stale reviewed row(s) in area movement; every reviewer run of 12 or more tokens needs a row in ${path.join(reviewedRunsDirectory, reviewedRunsFileName)}`);
  });

  it("exits 1 with the flag when a row is stale", () => {
    const { status, stderr } = runOverlapCommand(sharedCoreWorkspace(), {
      reviewedRunsTextsByFileName: { [reviewedRunsFileName]: JSON.stringify(reviewedRunsFileOf([sharedCoreRun, unrelatedRun])) }, requireReviewed: true,
    });
    expect(status).toBe(1);
    expect(stderr).toContain("0 unreviewed reviewer run(s) and 1 stale reviewed row(s) in area movement");
  });

  it.each([
    ["a file that is not JSON", "movement.json", "{", /reviewed-runs file .*movement\.json is not valid JSON/],
    ["a file named for no area", "bsp_visibility.json", JSON.stringify(reviewedRunsFileOf([sharedCoreRun], "bsp_visibility")), /names unknown area bsp_visibility/],
  ])("exits 2 for %s", (_caseName, fileName, text, expectedMessage) => {
    const { status, report, stderr } = runOverlapCommand(sharedCoreWorkspace(), { reviewedRunsTextsByFileName: { [fileName]: text } });
    expect(status).toBe(2);
    expect(report).toBeNull();
    expect(stderr).toMatch(expectedMessage);
  });
});

describe("reviewed-run file validation", () => {
  it.each<[string, (validFile: ReviewedRunsFile) => Record<string, unknown>, RegExp]>([
    ["a wrong schemaVersion", validFile => ({ movement: { ...validFile, schemaVersion: 2 } }), /schemaVersion 2 is not supported/],
    ["an area that does not match the file name", validFile => ({ movement: { ...validFile, area: "particles" } }), /names area particles, which does not match its file name/],
    ["an unknown area", validFile => ({ "unknown-area": { ...validFile, area: "unknown-area" } }), /names unknown area unknown-area/],
    ["other run fields", validFile => ({ movement: { ...validFile, runFields: ["tokenCount", "sourceTokensSha256"] } }), /runFields must be tokenCount, sourceTokensSha256, referenceFilesSha256, escalated, reason/],
    ["no reviews", validFile => ({ movement: { ...validFile, reviews: [] } }), /reviews must be a non-empty list/],
    ["a review date that is not a date", () => ({ movement: reviewedRunsFileOf([sharedCoreRun], "movement", "9 November") }), /reviewedOn must be a YYYY-MM-DD date/],
    ["an empty method", validFile => ({ movement: { ...validFile, reviews: [{ ...validFile.reviews[0]!, method: " " }] } }), /method must be non-empty text/],
    ["a row of the wrong length", () => ({ movement: reviewedRunsFileOf([sharedCoreRun.slice(0, 4) as unknown as ReviewedRunRow]) }), /must be a list of 5 fields/],
    ["a token count that is not an integer", () => ({ movement: reviewedRunsFileOf([["19", ...sharedCoreRun.slice(1)] as unknown as ReviewedRunRow]) }), /tokenCount must be a positive integer: 19/],
    ["an escalated flag that is not a boolean", () => ({ movement: reviewedRunsFileOf([[...sharedCoreRun.slice(0, 3), "no", "Reason."] as unknown as ReviewedRunRow]) }), /escalated must be true or false: no/],
    ["an upper-case source hash", () => ({ movement: reviewedRunsFileOf([[sharedCoreTokenCount, sharedCoreSourceTokensSha256.toUpperCase(), sharedCoreRun[2], false, "Reason."]]) }), /sourceTokensSha256 must be 64 lower-case hex characters/],
    ["a short reference file hash", () => ({ movement: reviewedRunsFileOf([[sharedCoreTokenCount, sharedCoreSourceTokensSha256, "abc", false, "Reason."]]) }), /referenceFilesSha256 must be 64 lower-case hex characters: abc/],
    ["an empty reason", () => ({ movement: reviewedRunsFileOf([[...sharedCoreRun.slice(0, 4), "  "] as unknown as ReviewedRunRow]) }), /reason must be non-empty text/],
    ["a row repeated in a later review", validFile => ({ movement: { ...validFile, reviews: [validFile.reviews[0]!, reviewedRunsFileOf([[...sharedCoreRun.slice(0, 4), "Again."] as unknown as ReviewedRunRow]).reviews[0]!] } }), /repeats the row for src\/scene\/world\/movement\/generatedCore\.ts with 19 tokens/],
  ])("refuses %s", (_caseName, buildReviewedRuns, expectedMessage) => {
    const reviewedRuns = buildReviewedRuns(reviewedRunsFileOf([sharedCoreRun])) as unknown as Record<string, ReviewedRunsFile>;
    const runWithMalformedReviewedRuns = () => runMovementOverlap(createWorkspace(), { reviewedRuns });
    expect(runWithMalformedReviewedRuns).toThrow(ReferenceOverlapSetupError);
    expect(runWithMalformedReviewedRuns).toThrow(expectedMessage);
  });
});
