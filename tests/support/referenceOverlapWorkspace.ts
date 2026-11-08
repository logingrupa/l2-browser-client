import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadOverlapAreas, runReferenceOverlap,
  type OverlapAreas, type ReferenceOverlapReport, type ReviewedRunsFile, type SignedOffRuns,
} from "../../tools/reference-overlap/referenceOverlap.mjs";

const fixtureDirectory = fileURLToPath(new URL("../fixtures/reference-overlap/", import.meta.url));
const toolPath = fileURLToPath(new URL("../../tools/reference-overlap/referenceOverlap.mjs", import.meta.url));
const temporaryWorkspaces: string[] = [];

export const overlapAreas = loadOverlapAreas();
export const lineage2jsPinnedCommit = overlapAreas.referenceClones.find(clone => clone.name === "lineage2js")!.commit;
export const movementSourceDirectory = "src/scene/world/movement";
export const lineage2jsClonePath = ".assets/reference/lineage2js";
export const generatedCoreSourceFile = `${movementSourceDirectory}/generatedCore.ts`;
export const generatedCoreClonePath = "src/physics/generatedCore.ts";
export const generatedCoreReferenceFile = `${lineage2jsClonePath}/${generatedCoreClonePath}`;
export const noSignedOffRuns: SignedOffRuns = { schemaVersion: 1, runs: [] };

export function removeTemporaryWorkspaces(): void {
  for (const workspace of temporaryWorkspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
}

export function createWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "reference-overlap-"));
  temporaryWorkspaces.push(workspace);
  return workspace;
}

export function writeWorkspaceFile(workspace: string, relativePath: string, text: string): void {
  mkdirSync(path.dirname(path.join(workspace, relativePath)), { recursive: true });
  writeFileSync(path.join(workspace, relativePath), text);
}

export function writeLineage2jsClone(workspace: string, filesByClonePath: Readonly<Record<string, string>>, headCommit = lineage2jsPinnedCommit): void {
  for (const [clonePath, text] of Object.entries(filesByClonePath)) writeWorkspaceFile(workspace, `${lineage2jsClonePath}/${clonePath}`, text);
  writeWorkspaceFile(workspace, `${lineage2jsClonePath}/.git/HEAD`, `${headCommit}\n`);
}

export function readFixture(relativePath: string): string {
  return readFileSync(path.join(fixtureDirectory, relativePath), "utf8");
}

export function writeFixtureWorkspace(sourceFileNames: readonly string[]): string {
  const workspace = createWorkspace();
  for (const fileName of sourceFileNames) {
    writeWorkspaceFile(workspace, `${movementSourceDirectory}/${fileName}`, readFixture(`repository/${movementSourceDirectory}/${fileName}`));
  }
  writeLineage2jsClone(workspace, { "src/physics/fixtureReference.ts": readFixture("reference-clone/src/physics/fixtureReference.ts") });
  return workspace;
}

export function writeSharedCoreWorkspace(sourceText: string, referenceTextsByClonePath: Readonly<Record<string, string>>): string {
  const workspace = createWorkspace();
  writeWorkspaceFile(workspace, generatedCoreSourceFile, sourceText);
  writeLineage2jsClone(workspace, referenceTextsByClonePath);
  return workspace;
}

export function overlapAreasWithMovementAllowlist(sourceFile: string, constantName: string): OverlapAreas {
  const movementArea = overlapAreas.areas["movement"]!;
  return { ...overlapAreas, areas: { ...overlapAreas.areas, movement: { ...movementArea, constantAllowlist: [{ sourceFile, constantName, kind: "opcodes" }] } } };
}

interface OverlapCommandOptions {
  readonly referenceRoot?: string;
  readonly signedOffRunsText?: string;
  readonly reviewedRunsTextsByFileName?: Readonly<Record<string, string>>;
  readonly requireReviewed?: boolean;
}

export function runOverlapCommand(workspace: string, { referenceRoot = workspace, signedOffRunsText = JSON.stringify(noSignedOffRuns), reviewedRunsTextsByFileName = {}, requireReviewed = false }: OverlapCommandOptions = {}) {
  const signedOffRunsPath = path.join(workspace, "signedOffRuns.json");
  const reviewedRunsDirectory = path.join(workspace, "reviewedRuns");
  writeFileSync(signedOffRunsPath, signedOffRunsText);
  mkdirSync(reviewedRunsDirectory, { recursive: true });
  for (const [fileName, text] of Object.entries(reviewedRunsTextsByFileName)) writeFileSync(path.join(reviewedRunsDirectory, fileName), text);
  const completed = spawnSync(process.execPath, [
    toolPath, "--area", "movement", "--repository-root", workspace, "--reference-root", referenceRoot,
    "--signed-off-runs", signedOffRunsPath, "--reviewed-runs", reviewedRunsDirectory, ...(requireReviewed ? ["--require-reviewed"] : []),
  ], { encoding: "utf8" });
  const report = completed.stdout === "" ? null : JSON.parse(completed.stdout) as ReferenceOverlapReport;
  return { status: completed.status, report, stderr: completed.stderr, signedOffRunsPath, reviewedRunsDirectory };
}

interface MovementOverlapOptions {
  readonly signedOffRuns?: SignedOffRuns;
  readonly reviewedRuns?: Readonly<Record<string, ReviewedRunsFile>>;
  readonly overlapAreas?: OverlapAreas;
}

export function runMovementOverlap(workspace: string, { signedOffRuns = noSignedOffRuns, reviewedRuns = {}, overlapAreas: areas = overlapAreas }: MovementOverlapOptions = {}): ReferenceOverlapReport {
  return runReferenceOverlap({ area: "movement", repositoryRoot: workspace, signedOffRuns, reviewedRuns, overlapAreas: areas });
}

export function sha256OfOriginalTokens(originalTokens: readonly string[]): string {
  return createHash("sha256").update(originalTokens.join("\u0001")).digest("hex");
}
