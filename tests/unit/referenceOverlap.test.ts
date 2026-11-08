import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ReferenceOverlapSetupError, loadOverlapAreas, normaliseSourceTokens, runReferenceOverlap, signOffReviewerRuns,
  type OverlapAreas, type ReferenceOverlapReport, type SignedOffRun, type SignedOffRuns,
} from "../../tools/reference-overlap/referenceOverlap.mjs";
import { alternatingCoreText, sourceAndReferenceWithSharedCore } from "../support/sharedTokenCore";

const fixtureDirectory = fileURLToPath(new URL("../fixtures/reference-overlap/", import.meta.url));
const toolDirectory = fileURLToPath(new URL("../../tools/reference-overlap/", import.meta.url));
const toolPath = path.join(toolDirectory, "referenceOverlap.mjs");
const movementSourceDirectory = "src/scene/world/movement";
const lineage2jsClonePath = ".assets/reference/lineage2js";
const generatedCoreSourceFile = `${movementSourceDirectory}/generatedCore.ts`;
const generatedCoreClonePath = "src/physics/generatedCore.ts";
const generatedCoreReferenceFile = `${lineage2jsClonePath}/${generatedCoreClonePath}`;
const noSignedOffRuns: SignedOffRuns = { schemaVersion: 1, runs: [] };
const areaNames = ["materials", "bsp-visibility", "movement", "particles", "network"];
const overlapAreas = loadOverlapAreas();
const lineage2jsPinnedCommit = overlapAreas.referenceClones.find(clone => clone.name === "lineage2js")!.commit;
const temporaryWorkspaces: string[] = [];

afterEach(() => {
  for (const workspace of temporaryWorkspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function createWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "reference-overlap-"));
  temporaryWorkspaces.push(workspace);
  return workspace;
}

function writeWorkspaceFile(workspace: string, relativePath: string, text: string): void {
  mkdirSync(path.dirname(path.join(workspace, relativePath)), { recursive: true });
  writeFileSync(path.join(workspace, relativePath), text);
}

function writeLineage2jsClone(workspace: string, filesByClonePath: Readonly<Record<string, string>>, headCommit = lineage2jsPinnedCommit): void {
  for (const [clonePath, text] of Object.entries(filesByClonePath)) writeWorkspaceFile(workspace, `${lineage2jsClonePath}/${clonePath}`, text);
  writeWorkspaceFile(workspace, `${lineage2jsClonePath}/.git/HEAD`, `${headCommit}\n`);
}

function readFixture(relativePath: string): string {
  return readFileSync(path.join(fixtureDirectory, relativePath), "utf8");
}

function writeFixtureWorkspace(sourceFileNames: readonly string[]): string {
  const workspace = createWorkspace();
  for (const fileName of sourceFileNames) {
    writeWorkspaceFile(workspace, `${movementSourceDirectory}/${fileName}`, readFixture(`repository/${movementSourceDirectory}/${fileName}`));
  }
  writeLineage2jsClone(workspace, { "src/physics/fixtureReference.ts": readFixture("reference-clone/src/physics/fixtureReference.ts") });
  return workspace;
}

function writeSharedCoreWorkspace(sourceText: string, referenceTextsByClonePath: Readonly<Record<string, string>>): string {
  const workspace = createWorkspace();
  writeWorkspaceFile(workspace, generatedCoreSourceFile, sourceText);
  writeLineage2jsClone(workspace, referenceTextsByClonePath);
  return workspace;
}

function runOverlapCommand(workspace: string, { referenceRoot = workspace, signedOffRunsText = JSON.stringify(noSignedOffRuns) }: { referenceRoot?: string; signedOffRunsText?: string } = {}) {
  const signedOffRunsPath = path.join(workspace, "signedOffRuns.json");
  writeFileSync(signedOffRunsPath, signedOffRunsText);
  const completed = spawnSync(process.execPath, [
    toolPath, "--area", "movement", "--repository-root", workspace, "--reference-root", referenceRoot, "--signed-off-runs", signedOffRunsPath,
  ], { encoding: "utf8" });
  const report = completed.stdout === "" ? null : JSON.parse(completed.stdout) as ReferenceOverlapReport;
  return { status: completed.status, report, stderr: completed.stderr, signedOffRunsPath };
}

function runMovementOverlap(workspace: string, signedOffRuns: SignedOffRuns): ReferenceOverlapReport {
  return runReferenceOverlap({ area: "movement", repositoryRoot: workspace, signedOffRuns });
}

function sha256OfOriginalTokens(originalTokens: readonly string[]): string {
  return createHash("sha256").update(originalTokens.join("\u0001")).digest("hex");
}

function genericSignOff(overrides: Partial<SignedOffRun> = {}): SignedOffRun {
  return {
    area: "movement",
    sourceFile: generatedCoreSourceFile,
    tokenCount: 20,
    sourceTokensSha256: sha256OfOriginalTokens(alternatingCoreText(20, "alpha").split(" ")),
    referenceFiles: [generatedCoreReferenceFile],
    verdict: "generic",
    reviewedOn: "2026-11-08",
    review: "Three synthetic reviewers judged this fixture run generic.",
    evidence: "docs/parts/adapter-dispatch/EVIDENCE.md",
    ...overrides,
  };
}

function signedOffRunsOf(...runs: SignedOffRun[]): SignedOffRuns {
  return { schemaVersion: 1, runs };
}

function withoutField(entry: SignedOffRun, fieldName: keyof SignedOffRun): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entry).filter(([entryFieldName]) => entryFieldName !== fieldName));
}

function summariseRuns(report: ReferenceOverlapReport) {
  return {
    reviewer: report.reviewerRuns.map(run => `${path.posix.basename(run.sourceFile)}:${run.sourceStartLine}-${run.sourceEndLine}:${run.tokenCount}`),
    blocking: report.blockingRuns.map(run => `${path.posix.basename(run.sourceFile)}:${run.sourceStartLine}-${run.sourceEndLine}:${run.tokenCount}`),
  };
}

function overlapAreasWithMovementAllowlist(sourceFile: string, constantName: string): OverlapAreas {
  const movementArea = overlapAreas.areas["movement"]!;
  return { ...overlapAreas, areas: { ...overlapAreas.areas, movement: { ...movementArea, constantAllowlist: [{ sourceFile, constantName, kind: "opcodes" }] } } };
}

describe("reference overlap command over the movement area", () => {
  it.each([[19, 0, 1], [20, 1, 1]])("classifies a %i token run with exit %i and %i reviewer run", (tokenCount, expectedStatus, expectedReviewerRuns) => {
    const { sourceText, referenceText } = sourceAndReferenceWithSharedCore(tokenCount);
    const { status, report } = runOverlapCommand(writeSharedCoreWorkspace(sourceText, { [generatedCoreClonePath]: referenceText }));
    expect(status).toBe(expectedStatus);
    expect(report!.reviewerRuns).toHaveLength(expectedReviewerRuns);
    expect(report!.blockingRuns).toHaveLength(expectedStatus);
    expect(report!.reviewerRuns[0]!.referenceMatches).toEqual([{ referenceFile: generatedCoreReferenceFile, referenceStartLine: 1, referenceEndLine: 1 }]);
  });

  it("blocks a renamed copy of a function and lists the smaller shared runs for the reviewer", () => {
    const { status, report, stderr } = runOverlapCommand(writeFixtureWorkspace(["stepIntegration.ts", "headingWrap.ts", "replyCodeTable.ts"]));
    expect(status).toBe(1);
    expect(stderr).toContain("2 shared run(s) of 20 or more tokens outside the constant allowlist and the sign-offs in area movement");
    expect(report!.referenceCommits).toEqual({ lineage2js: lineage2jsPinnedCommit });
    expect(summariseRuns(report!)).toEqual({
      reviewer: ["headingWrap.ts:1-3:18", "replyCodeTable.ts:1-1:29", "stepIntegration.ts:1-5:19", "stepIntegration.ts:7-11:56"],
      blocking: ["replyCodeTable.ts:1-1:29", "stepIntegration.ts:7-11:56"],
    });
  });

  it("passes with a reviewer run when the only shared run is shorter than 20 tokens", () => {
    const { status, report } = runOverlapCommand(writeFixtureWorkspace(["headingWrap.ts"]));
    expect(status).toBe(0);
    expect(summariseRuns(report!)).toEqual({ reviewer: ["headingWrap.ts:1-3:18"], blocking: [] });
  });

  it("exits 2 with the reason when the reference clone is absent", () => {
    const workspace = writeFixtureWorkspace(["headingWrap.ts"]);
    const emptyReferenceRoot = createWorkspace();
    const { status, report, stderr } = runOverlapCommand(workspace, { referenceRoot: emptyReferenceRoot });
    expect(status).toBe(2);
    expect(report).toBeNull();
    expect(stderr.trim()).toBe(`reference clone absent: ${path.join(emptyReferenceRoot, lineage2jsClonePath)}`);
  });

  it("exits 2 when the reference clone is not at the pinned commit", () => {
    const workspace = createWorkspace();
    writeLineage2jsClone(workspace, { "src/physics/fixtureReference.ts": readFixture("reference-clone/src/physics/fixtureReference.ts") }, "0".repeat(40));
    const { status, stderr } = runOverlapCommand(workspace);
    expect(status).toBe(2);
    expect(stderr).toContain(`reference clone lineage2js is at ${"0".repeat(40)}, pinned ${lineage2jsPinnedCommit}`);
  });
});

describe("constant table allowlist", () => {
  it("turns a 20 or more token run inside an allowlisted constant table into a reviewer run only", () => {
    const workspace = writeFixtureWorkspace(["replyCodeTable.ts"]);
    const report = runReferenceOverlap({
      area: "movement", repositoryRoot: workspace,
      overlapAreas: overlapAreasWithMovementAllowlist(`${movementSourceDirectory}/replyCodeTable.ts`, "fixtureReplyCodeTable"),
    });
    expect(report.blockingRuns).toEqual([]);
    expect(report.reviewerRuns.map(run => [run.tokenCount, run.allowlistedConstant])).toEqual([[29, { constantName: "fixtureReplyCodeTable", kind: "opcodes" }]]);
  });

  it("refuses an allowlisted constant that the source does not declare", () => {
    const workspace = writeFixtureWorkspace(["replyCodeTable.ts"]);
    const overlapAreasWithMissingConstant = overlapAreasWithMovementAllowlist(`${movementSourceDirectory}/replyCodeTable.ts`, "missingTable");
    expect(() => runReferenceOverlap({ area: "movement", repositoryRoot: workspace, overlapAreas: overlapAreasWithMissingConstant }))
      .toThrow(ReferenceOverlapSetupError);
  });

  it("refuses an unknown area", () => {
    expect(() => runReferenceOverlap({ area: "unknown-area", repositoryRoot: createWorkspace() })).toThrow(/unknown area unknown-area/);
  });
});

describe("reviewer sign-offs", () => {
  const sharedCore = sourceAndReferenceWithSharedCore(20);
  const sharedCoreReferenceTexts = { [generatedCoreClonePath]: sharedCore.referenceText };
  const signedOffSharedCore = signedOffRunsOf(genericSignOff());

  it("hashes the exact original text of the run's source tokens joined by U+0001", () => {
    const report = runMovementOverlap(writeSharedCoreWorkspace(sharedCore.sourceText, sharedCoreReferenceTexts), noSignedOffRuns);
    expect(report.reviewerRuns.map(run => run.sourceTokensSha256)).toEqual([sha256OfOriginalTokens(alternatingCoreText(20, "alpha").split(" "))]);
    expect(report.reviewerRuns.map(run => run.signedOff)).toEqual([null]);
  });

  it("takes a signed-off 20 token run out of blockingRuns and attaches its sign-off", () => {
    const report = runMovementOverlap(writeSharedCoreWorkspace(sharedCore.sourceText, sharedCoreReferenceTexts), signedOffSharedCore);
    expect(report.blockingRuns).toEqual([]);
    expect(report.reviewerRuns.map(run => run.signedOff)).toEqual([{ verdict: "generic", reviewedOn: "2026-11-08", evidence: "docs/parts/adapter-dispatch/EVIDENCE.md" }]);
    expect(report.signedOffRunCount).toBe(1);
    expect(report.staleSignedOffRuns).toEqual([]);
  });

  it("blocks again when one source token keeps its normalised shape but changes its text, and reports the old sign-off stale", () => {
    const renamedSourceText = sharedCore.sourceText.replace("alpha0", "renamed0");
    expect(normaliseSourceTokens(renamedSourceText).map(token => token.normalised)).toEqual(normaliseSourceTokens(sharedCore.sourceText).map(token => token.normalised));
    const report = runMovementOverlap(writeSharedCoreWorkspace(renamedSourceText, sharedCoreReferenceTexts), signedOffSharedCore);
    expect(report.blockingRuns.map(run => [run.tokenCount, run.signedOff])).toEqual([[20, null]]);
    expect(report.signedOffRunCount).toBe(0);
    expect(report.staleSignedOffRuns).toEqual(signedOffSharedCore.runs);
  });

  it("keeps a run blocking when it also matches a reference file outside the sign-off", () => {
    const secondCoreClonePath = "src/physics/secondCore.ts";
    const workspace = writeSharedCoreWorkspace(sharedCore.sourceText, { ...sharedCoreReferenceTexts, [secondCoreClonePath]: sharedCore.referenceText });
    const report = runMovementOverlap(workspace, signedOffSharedCore);
    expect(report.blockingRuns.map(run => run.referenceMatches.map(referenceMatch => referenceMatch.referenceFile)))
      .toEqual([[generatedCoreReferenceFile, `${lineage2jsClonePath}/${secondCoreClonePath}`]]);
    expect(report.blockingRuns.map(run => run.signedOff)).toEqual([null]);
  });

  it("ignores a sign-off for another area", () => {
    const report = runMovementOverlap(writeSharedCoreWorkspace(sharedCore.sourceText, sharedCoreReferenceTexts), signedOffRunsOf(genericSignOff({ area: "particles" })));
    expect(report.blockingRuns).toHaveLength(1);
    expect(report.signedOffRunCount).toBe(0);
    expect(report.staleSignedOffRuns).toEqual([]);
  });

  it("exits 0 on the command line once the only blocking run is signed off", () => {
    const workspace = writeSharedCoreWorkspace(sharedCore.sourceText, sharedCoreReferenceTexts);
    const { status, report, stderr } = runOverlapCommand(workspace, { signedOffRunsText: JSON.stringify(signedOffSharedCore) });
    expect(status).toBe(0);
    expect(stderr).toBe("");
    expect(report!.signedOffRunCount).toBe(1);
  });

  it("exits 1 on the command line and names the stale sign-off when it matches no reviewer run", () => {
    const shorterCore = sourceAndReferenceWithSharedCore(19);
    const workspace = writeSharedCoreWorkspace(shorterCore.sourceText, { [generatedCoreClonePath]: shorterCore.referenceText });
    const { status, report, stderr, signedOffRunsPath } = runOverlapCommand(workspace, { signedOffRunsText: JSON.stringify(signedOffSharedCore) });
    expect(status).toBe(1);
    expect(report!.blockingRuns).toEqual([]);
    expect(report!.staleSignedOffRuns).toEqual(signedOffSharedCore.runs);
    expect(stderr.trim()).toBe(`1 stale sign-off(s) in area movement match no reviewer run; remove them from ${signedOffRunsPath}`);
  });

  it.each<[string, (validEntry: SignedOffRun) => unknown, RegExp]>([
    ["a wrong schemaVersion", validEntry => ({ schemaVersion: 2, runs: [validEntry] }), /sign-off schemaVersion 2 is not supported/],
    ["a missing field", validEntry => ({ schemaVersion: 1, runs: [withoutField(validEntry, "review")] }), /sign-off runs\[0\] is missing the field review/],
    ["a non-hex hash", validEntry => signedOffRunsOf({ ...validEntry, sourceTokensSha256: "g".repeat(64) }), /sourceTokensSha256 must be 64 lower-case hex characters/],
    ["an unknown area", validEntry => signedOffRunsOf({ ...validEntry, area: "unknown-area" }), /names unknown area unknown-area/],
    ["a duplicate area, source and hash", validEntry => signedOffRunsOf(validEntry, { ...validEntry, review: "A second review of the same run." }), /sign-off runs\[1\] repeats area movement/],
    ["unsorted reference files", validEntry => signedOffRunsOf({ ...validEntry, referenceFiles: ["b.ts", "a.ts"] }), /referenceFiles must be sorted and unique/],
    ["a derived verdict", validEntry => signedOffRunsOf({ ...validEntry, verdict: "derived" }), /sign-off runs\[0\] verdict must be generic: derived/],
    ["the network area", validEntry => signedOffRunsOf({ ...validEntry, area: "network" }), /names area network, which takes no sign-offs/],
  ])("refuses sign-off data with %s", (_caseName, buildSignedOffRuns, expectedMessage) => {
    const malformedSignedOffRuns = buildSignedOffRuns(genericSignOff()) as SignedOffRuns;
    const runWithMalformedSignOffs = () => runMovementOverlap(createWorkspace(), malformedSignedOffRuns);
    expect(runWithMalformedSignOffs).toThrow(ReferenceOverlapSetupError);
    expect(runWithMalformedSignOffs).toThrow(expectedMessage);
  });

  it("never lets a sign-off without the generic verdict cover a run, even past validation", () => {
    const report = runMovementOverlap(writeSharedCoreWorkspace(sharedCore.sourceText, sharedCoreReferenceTexts), noSignedOffRuns);
    const derivedSignOff = genericSignOff({ verdict: "derived" });
    const { reviewerRuns, staleSignedOffRuns } = signOffReviewerRuns(report.reviewerRuns, [derivedSignOff], "movement");
    expect(reviewerRuns.map(run => run.signedOff)).toEqual([null]);
    expect(staleSignedOffRuns).toEqual([derivedSignOff]);
  });

  it("exits 2 on the command line when the sign-off file is not JSON", () => {
    const { status, report, stderr, signedOffRunsPath } = runOverlapCommand(writeFixtureWorkspace(["headingWrap.ts"]), { signedOffRunsText: "{" });
    expect(status).toBe(2);
    expect(report).toBeNull();
    expect(stderr).toContain(`sign-off file ${signedOffRunsPath} is not valid JSON`);
  });
});

describe("overlap area map", () => {
  it("declares the five DEC-OWN-12 areas with source globs, reference globs under a pinned clone and an allowlist", () => {
    expect(Object.keys(overlapAreas.areas).sort()).toEqual([...areaNames].sort());
    expect(overlapAreas.thresholds).toEqual({ reviewerRunTokens: 12, blockingRunTokens: 20 });
    expect(overlapAreas.referenceClones.map(clone => [clone.name, clone.path, clone.commit])).toEqual([
      ["lineage2js", ".assets/reference/lineage2js", "854f62920319c458f9d339f8463b2ec8ed16fa9a"],
      ["l2js-core", ".assets/reference/l2js-core", "4aac1bd28945746aa2ecddd72c96e473592ee0bd"],
    ]);
    for (const areaName of areaNames) {
      const area = overlapAreas.areas[areaName]!;
      expect(area.sourceGlobs.length).toBeGreaterThan(0);
      expect(area.referenceGlobs.length).toBeGreaterThan(0);
      expect(area.referenceGlobs.every(referenceGlob => referenceGlob.startsWith(".assets/reference/lineage2js/") || referenceGlob.startsWith(".assets/reference/l2js-core/"))).toBe(true);
      expect(Array.isArray(area.constantAllowlist)).toBe(true);
    }
  });

  it("reads reference files as text only and never executes them", () => {
    const toolSources = readdirSync(toolDirectory).filter(fileName => fileName.endsWith(".mjs")).map(fileName => readFileSync(path.join(toolDirectory, fileName), "utf8"));
    expect(toolSources.length).toBe(6);
    for (const toolSource of toolSources) expect(toolSource).not.toMatch(/child_process|\bimport\(|\brequire\(|\beval\(|new Function|node:vm|node:worker_threads/);
  });
});
