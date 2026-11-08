import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expandRepositoryGlobs } from "./repositoryGlob.mjs";
import { findSharedTokenRuns } from "./sharedTokenRuns.mjs";
import { normaliseSourceTokens } from "./sourceTokens.mjs";

export { findSharedTokenRuns } from "./sharedTokenRuns.mjs";
export { normaliseSourceTokens } from "./sourceTokens.mjs";

const exitCodeNoBlockingRun = 0;
const exitCodeBlockingRun = 1;
const exitCodeSetupFailure = 2;
const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(toolDirectory, "../..");
const overlapAreasPath = path.join(toolDirectory, "overlapAreas.json");
const detachedCommitPattern = /^[0-9a-f]{40}$/;
const declarationKeywords = new Set(["const", "let", "var", "enum"]);
const openingBrackets = new Set(["(", "[", "{"]);
const closingBrackets = new Set([")", "]", "}"]);

export class ReferenceOverlapSetupError extends Error {}

export function loadOverlapAreas() {
  return JSON.parse(readFileSync(overlapAreasPath, "utf8"));
}

function requireArea(overlapAreas, areaName) {
  const area = overlapAreas.areas[areaName];
  if (area === undefined) throw new ReferenceOverlapSetupError(`unknown area ${areaName}; use one of ${Object.keys(overlapAreas.areas).join(", ")}`);
  return area;
}

function cloneForReferenceGlob(overlapAreas, referenceGlob) {
  const clone = overlapAreas.referenceClones.find(candidate => referenceGlob.startsWith(`${candidate.path}/`));
  if (clone === undefined) throw new ReferenceOverlapSetupError(`reference glob outside every reference clone: ${referenceGlob}`);
  return clone;
}

function verifyReferenceClones(referenceRoot, clones) {
  return Object.fromEntries(clones.map(clone => {
    const cloneDirectory = path.join(referenceRoot, clone.path);
    if (!existsSync(cloneDirectory)) throw new ReferenceOverlapSetupError(`reference clone absent: ${cloneDirectory}`);
    const headPath = path.join(cloneDirectory, ".git", "HEAD");
    if (!existsSync(headPath)) throw new ReferenceOverlapSetupError(`reference clone has no git HEAD: ${cloneDirectory}`);
    const observedCommit = readFileSync(headPath, "utf8").trim();
    if (!detachedCommitPattern.test(observedCommit) || observedCommit !== clone.commit) {
      throw new ReferenceOverlapSetupError(`reference clone ${clone.name} is at ${observedCommit}, pinned ${clone.commit}: ${cloneDirectory}`);
    }
    return [clone.name, observedCommit];
  }));
}

function buildTokenCorpus(rootDirectory, filePaths, boundaryLabel) {
  const tokens = [];
  const tokenFileIndexes = [];
  filePaths.forEach((filePath, fileIndex) => {
    for (const token of normaliseSourceTokens(readFileSync(path.join(rootDirectory, filePath), "utf8"))) {
      tokens.push(token);
      tokenFileIndexes.push(fileIndex);
    }
    tokens.push({ normalised: `\u0000${boundaryLabel}-boundary-${fileIndex}`, original: "", line: 0 });
    tokenFileIndexes.push(fileIndex);
  });
  return { filePaths, tokens, tokenFileIndexes };
}

function declarationTokenRange(tokens, nameIndex) {
  const declarationStart = nameIndex - 1;
  const isEnumDeclaration = tokens[declarationStart].normalised === "enum";
  let depth = 0;
  for (let index = nameIndex + 1; index < tokens.length; index += 1) {
    const normalised = tokens[index].normalised;
    if (openingBrackets.has(normalised)) depth += 1;
    else if (closingBrackets.has(normalised)) {
      depth -= 1;
      if (isEnumDeclaration && depth === 0) return { start: declarationStart, end: index };
    } else if (normalised === ";" && depth === 0) return { start: declarationStart, end: index };
    else if (normalised.startsWith("\u0000")) return { start: declarationStart, end: index - 1 };
  }
  return { start: declarationStart, end: tokens.length - 1 };
}

function locateAllowlistedConstants(sourceCorpus, constantAllowlist) {
  return constantAllowlist.map(allowlistedConstant => {
    const fileIndex = sourceCorpus.filePaths.indexOf(allowlistedConstant.sourceFile);
    if (fileIndex === -1) throw new ReferenceOverlapSetupError(`allowlisted constant file is not an area source: ${allowlistedConstant.sourceFile}`);
    const nameIndex = sourceCorpus.tokens.findIndex((token, index) => sourceCorpus.tokenFileIndexes[index] === fileIndex
      && token.original === allowlistedConstant.constantName && declarationKeywords.has(sourceCorpus.tokens[index - 1]?.normalised));
    if (nameIndex === -1) throw new ReferenceOverlapSetupError(`allowlisted constant not declared: ${allowlistedConstant.sourceFile} ${allowlistedConstant.constantName}`);
    return { ...allowlistedConstant, range: declarationTokenRange(sourceCorpus.tokens, nameIndex) };
  });
}

function groupRunsBySourceSpan(runs, sourceCorpus, referenceCorpus, allowlistedConstants) {
  const groupsBySpan = new Map();
  for (const run of runs) {
    const sourceEnd = run.sourceStart + run.tokenCount - 1;
    const spanKey = `${run.sourceStart}:${run.tokenCount}`;
    if (!groupsBySpan.has(spanKey)) {
      const allowlistedConstant = allowlistedConstants.find(constant => constant.range.start <= run.sourceStart && sourceEnd <= constant.range.end);
      groupsBySpan.set(spanKey, {
        sourceFile: sourceCorpus.filePaths[sourceCorpus.tokenFileIndexes[run.sourceStart]],
        sourceStartLine: sourceCorpus.tokens[run.sourceStart].line,
        sourceEndLine: sourceCorpus.tokens[sourceEnd].line,
        tokenCount: run.tokenCount,
        allowlistedConstant: allowlistedConstant === undefined ? null : { constantName: allowlistedConstant.constantName, kind: allowlistedConstant.kind },
        referenceMatches: [],
      });
    }
    groupsBySpan.get(spanKey).referenceMatches.push({
      referenceFile: referenceCorpus.filePaths[referenceCorpus.tokenFileIndexes[run.referenceStart]],
      referenceStartLine: referenceCorpus.tokens[run.referenceStart].line,
      referenceEndLine: referenceCorpus.tokens[run.referenceStart + run.tokenCount - 1].line,
    });
  }
  return [...groupsBySpan.values()];
}

export function runReferenceOverlap({ area: areaName, repositoryRoot = defaultRepositoryRoot, referenceRoot = repositoryRoot, overlapAreas = loadOverlapAreas() }) {
  const area = requireArea(overlapAreas, areaName);
  const { reviewerRunTokens, blockingRunTokens } = overlapAreas.thresholds;
  const areaClones = [...new Set(area.referenceGlobs.map(referenceGlob => cloneForReferenceGlob(overlapAreas, referenceGlob)))];
  const referenceCommits = verifyReferenceClones(referenceRoot, areaClones);
  const referenceFiles = expandRepositoryGlobs(referenceRoot, area.referenceGlobs);
  if (referenceFiles.length === 0) throw new ReferenceOverlapSetupError(`reference globs of ${areaName} match no file under ${referenceRoot}`);
  const sourceCorpus = buildTokenCorpus(repositoryRoot, expandRepositoryGlobs(repositoryRoot, area.sourceGlobs), "source");
  const referenceCorpus = buildTokenCorpus(referenceRoot, referenceFiles, "reference");
  const allowlistedConstants = locateAllowlistedConstants(sourceCorpus, area.constantAllowlist);
  const sharedRuns = findSharedTokenRuns(sourceCorpus.tokens, referenceCorpus.tokens, reviewerRunTokens);
  const reviewerRuns = groupRunsBySourceSpan(sharedRuns, sourceCorpus, referenceCorpus, allowlistedConstants);
  return {
    area: areaName,
    referenceCommits,
    thresholds: { reviewerRunTokens, blockingRunTokens },
    sourceFiles: sourceCorpus.filePaths,
    referenceFileCount: referenceFiles.length,
    reviewerRuns,
    blockingRuns: reviewerRuns.filter(run => run.tokenCount >= blockingRunTokens && run.allowlistedConstant === null),
  };
}

function readCommandLineOptions(argumentList) {
  const optionKeys = { "--area": "area", "--repository-root": "repositoryRoot", "--reference-root": "referenceRoot" };
  const options = {};
  for (let index = 0; index < argumentList.length; index += 2) {
    const optionKey = optionKeys[argumentList[index]];
    const optionValue = argumentList[index + 1];
    if (optionKey === undefined) throw new ReferenceOverlapSetupError(`unknown option ${argumentList[index]}; use --area <name> [--repository-root <dir>] [--reference-root <dir>]`);
    if (optionValue === undefined || optionValue === "") throw new ReferenceOverlapSetupError(`${argumentList[index]} needs a value`);
    options[optionKey] = optionKey === "area" ? optionValue : path.resolve(optionValue);
  }
  if (options.area === undefined) throw new ReferenceOverlapSetupError("--area <name> is required");
  return options;
}

function runReferenceOverlapCommand() {
  const report = runReferenceOverlap(readCommandLineOptions(process.argv.slice(2)));
  console.log(JSON.stringify(report, null, 2));
  if (report.blockingRuns.length === 0) return exitCodeNoBlockingRun;
  console.error(`${report.blockingRuns.length} shared run(s) of ${report.thresholds.blockingRunTokens} or more tokens outside the constant allowlist in area ${report.area}`);
  return exitCodeBlockingRun;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runReferenceOverlapCommand();
  } catch (error) {
    console.error(error.message);
    process.exitCode = exitCodeSetupFailure;
  }
}
