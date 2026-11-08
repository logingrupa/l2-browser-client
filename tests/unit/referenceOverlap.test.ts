import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ReferenceOverlapSetupError, findSharedTokenRuns, loadOverlapAreas, normaliseSourceTokens, runReferenceOverlap,
  type OverlapAreas, type ReferenceOverlapReport,
} from "../../tools/reference-overlap/referenceOverlap.mjs";

const fixtureDirectory = fileURLToPath(new URL("../fixtures/reference-overlap/", import.meta.url));
const toolDirectory = fileURLToPath(new URL("../../tools/reference-overlap/", import.meta.url));
const toolPath = path.join(toolDirectory, "referenceOverlap.mjs");
const movementSourceDirectory = "src/scene/world/movement";
const lineage2jsClonePath = ".assets/reference/lineage2js";
const areaNames = ["materials", "bsp-visibility", "movement", "particles", "network"];
const overlapAreas = loadOverlapAreas();
const lineage2jsPinnedCommit = overlapAreas.referenceClones.find(clone => clone.name === "lineage2js")!.commit;
const temporaryWorkspaces: string[] = [];

afterEach(() => {
  for (const workspace of temporaryWorkspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function alternatingCoreText(tokenCount: number, identifierPrefix: string, replacedNumberIndex: number | null = null): string {
  return Array.from({ length: tokenCount }, (_, index) => {
    if (index % 2 === 0) return `${identifierPrefix}${index}`;
    return String(index === replacedNumberIndex ? 9000 + index : 1000 + index);
  }).join(" ");
}

function sharedRunLengths(sourceText: string, referenceText: string, minimumRun: number): number[] {
  return findSharedTokenRuns(normaliseSourceTokens(sourceText), normaliseSourceTokens(referenceText), minimumRun).map(run => run.tokenCount);
}

function sourceAndReferenceWithSharedCore(tokenCount: number): { sourceText: string; referenceText: string } {
  return {
    sourceText: `7001 ${alternatingCoreText(tokenCount, "alpha")} 7002`,
    referenceText: `8001 ${alternatingCoreText(tokenCount, "beta")} 8002`,
  };
}

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

function runOverlapCommand(workspace: string, referenceRoot = workspace) {
  const completed = spawnSync(process.execPath, [toolPath, "--area", "movement", "--repository-root", workspace, "--reference-root", referenceRoot], { encoding: "utf8" });
  const report = completed.stdout === "" ? null : JSON.parse(completed.stdout) as ReferenceOverlapReport;
  return { status: completed.status, report, stderr: completed.stderr };
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

describe("normaliseSourceTokens", () => {
  it("replaces identifiers and strings with placeholders, strips comments and imports, and keeps canonical numbers", () => {
    const tokens = normaliseSourceTokens('import { thing } from "./thing";\nconst label = "a"; // trailing\n/* block\n */ let count = 0x10 + 1_000;\nconst lazy = import("./lazy");');
    expect(tokens.map(token => token.normalised)).toEqual([
      "const", "<identifier>", "=", "<string>", ";",
      "let", "<identifier>", "=", "16", "+", "1000", ";",
      "const", "<identifier>", "=", "import", "(", "<string>", ")", ";",
    ]);
    expect(tokens.map(token => token.line)).toEqual([2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5]);
  });

  it("reads multi-character operators as one token", () => {
    expect(normaliseSourceTokens("a >>>= b ?? c?.d === e").map(token => token.normalised))
      .toEqual(["<identifier>", ">>>=", "<identifier>", "??", "<identifier>", "?.", "<identifier>", "===", "<identifier>"]);
  });
});

describe("findSharedTokenRuns thresholds", () => {
  it("gives no finding for 11 shared tokens and one finding for 12", () => {
    const eleven = sourceAndReferenceWithSharedCore(11);
    const twelve = sourceAndReferenceWithSharedCore(12);
    expect(sharedRunLengths(eleven.sourceText, eleven.referenceText, 12)).toEqual([]);
    expect(sharedRunLengths(twelve.sourceText, twelve.referenceText, 12)).toEqual([12]);
  });

  it("reports one maximal run for 20 shared tokens, not its sub-runs", () => {
    const twenty = sourceAndReferenceWithSharedCore(20);
    expect(sharedRunLengths(twenty.sourceText, twenty.referenceText, 12)).toEqual([20]);
  });

  it("is not hidden by renaming every identifier consistently", () => {
    const sourceText = "const total = first + second * first ; return total - second ;";
    const renamedText = "const sum = left + right * left ; return sum - right ;";
    expect(sharedRunLengths(sourceText, renamedText, 12)).toEqual([14]);
  });

  it("separates identifiers that the reference keeps apart", () => {
    const sourceText = "const total = first + second * first ; return total - second ;";
    const differentlyBoundText = "const sum = left + right * right ; return sum - left ;";
    expect(sharedRunLengths(sourceText, differentlyBoundText, 12)).toEqual([]);
  });

  it("is broken by changing one numeric literal", () => {
    const changedSourceText = `7001 ${alternatingCoreText(20, "alpha", 9)} 7002`;
    const referenceText = `8001 ${alternatingCoreText(20, "beta")} 8002`;
    expect(sharedRunLengths(changedSourceText, referenceText, 12)).toEqual([]);
  });

  it("is not hidden by comments inside the run", () => {
    const sourceCore = alternatingCoreText(12, "alpha").split(" ");
    const commentedSourceText = `7001 ${sourceCore.slice(0, 6).join(" ")} /* note */ ${sourceCore.slice(6, 9).join(" ")} // note\n${sourceCore.slice(9).join(" ")} 7002`;
    expect(sharedRunLengths(commentedSourceText, sourceAndReferenceWithSharedCore(12).referenceText, 12)).toEqual([12]);
  });

  it("refuses a minimum run that is not a positive integer", () => {
    expect(() => findSharedTokenRuns([], [], 0)).toThrow(RangeError);
  });
});

describe("reference overlap command over the movement area", () => {
  it.each([[19, 0, 1], [20, 1, 1]])("classifies a %i token run with exit %i and %i reviewer run", (tokenCount, expectedStatus, expectedReviewerRuns) => {
    const workspace = createWorkspace();
    const { sourceText, referenceText } = sourceAndReferenceWithSharedCore(tokenCount);
    writeWorkspaceFile(workspace, `${movementSourceDirectory}/generatedCore.ts`, sourceText);
    writeLineage2jsClone(workspace, { "src/physics/generatedCore.ts": referenceText });
    const { status, report } = runOverlapCommand(workspace);
    expect(status).toBe(expectedStatus);
    expect(report!.reviewerRuns).toHaveLength(expectedReviewerRuns);
    expect(report!.blockingRuns).toHaveLength(expectedStatus);
    expect(report!.reviewerRuns[0]!.referenceMatches).toEqual([{ referenceFile: `${lineage2jsClonePath}/src/physics/generatedCore.ts`, referenceStartLine: 1, referenceEndLine: 1 }]);
  });

  it("blocks a renamed copy of a function and lists the smaller shared runs for the reviewer", () => {
    const { status, report, stderr } = runOverlapCommand(writeFixtureWorkspace(["stepIntegration.ts", "headingWrap.ts", "replyCodeTable.ts"]));
    expect(status).toBe(1);
    expect(stderr).toContain("2 shared run(s) of 20 or more tokens outside the constant allowlist in area movement");
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
    const { status, report, stderr } = runOverlapCommand(workspace, emptyReferenceRoot);
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
    expect(toolSources.length).toBe(4);
    for (const toolSource of toolSources) expect(toolSource).not.toMatch(/child_process|\bimport\(|\brequire\(|\beval\(|new Function|node:vm|node:worker_threads/);
  });
});
