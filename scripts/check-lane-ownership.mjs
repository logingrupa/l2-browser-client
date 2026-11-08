import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const recursiveWildcard = "**";
const directoryPatternSuffix = `/${recursiveWildcard}`;
const patternGrammarHint = `use an exact path or <dir>/${recursiveWildcard}`;
const exactPathPattern = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const laneBranchPattern = /^[a-z0-9-]+\/[a-z0-9._-]+$/;
const gitReferencePattern = /^[A-Za-z0-9._/-]+$/;
const laneOwnershipFilePath = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".planning", "lanes.json");

function isDirectoryPattern(pattern) {
  return pattern.endsWith(directoryPatternSuffix) && exactPathPattern.test(pattern.slice(0, -directoryPatternSuffix.length));
}

function isValidOwnershipPattern(pattern) {
  return typeof pattern === "string" && (isDirectoryPattern(pattern) || exactPathPattern.test(pattern));
}

function requireStringArray(value, description) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${description} must be an array of strings`);
  }
  return value;
}

export function validateLaneOwnership(ownership) {
  if (ownership === null || typeof ownership !== "object") throw new Error("lane ownership must be an object");
  if (ownership.schemaVersion !== 1) throw new Error(`unsupported lane ownership schemaVersion ${String(ownership.schemaVersion)}`);
  const rules = ownership.rules;
  if (rules === null || typeof rules !== "object") throw new Error("lane ownership rules must be an object");
  const lanes = ownership.lanes;
  if (lanes === null || typeof lanes !== "object") throw new Error("lane ownership lanes must be an object");
  if (!Object.hasOwn(lanes, rules.unclaimedPathOwner)) throw new Error(`unclaimedPathOwner ${String(rules.unclaimedPathOwner)} is not a lane`);
  for (const pattern of requireStringArray(rules.sharedByAllLanes, "rules.sharedByAllLanes")) {
    if (!isValidOwnershipPattern(pattern)) throw new Error(`invalid shared pattern ${pattern}: ${patternGrammarHint}`);
  }
  const laneOfPattern = new Map();
  const laneOfPartSlug = new Map();
  for (const [laneName, lane] of Object.entries(lanes)) {
    if (lane === null || typeof lane !== "object") throw new Error(`lane ${laneName} must be an object`);
    for (const pattern of requireStringArray(lane.owns, `lane ${laneName} owns`)) {
      if (!isValidOwnershipPattern(pattern)) throw new Error(`invalid pattern ${pattern} in lane ${laneName}: ${patternGrammarHint}`);
      const claimingLane = laneOfPattern.get(pattern);
      if (claimingLane !== undefined) throw new Error(`pattern ${pattern} claimed by two lanes: ${claimingLane} and ${laneName}`);
      laneOfPattern.set(pattern, laneName);
    }
    for (const part of requireStringArray(lane.parts, `lane ${laneName} parts`)) {
      const claimingLane = laneOfPartSlug.get(part);
      if (claimingLane !== undefined) throw new Error(`part ${part} claimed by two lanes: ${claimingLane} and ${laneName}`);
      laneOfPartSlug.set(part, laneName);
    }
  }
  return ownership;
}

export function readLaneOwnership(filePath) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`cannot read lane ownership file ${filePath}: ${error.message}`);
  }
  let ownership;
  try {
    ownership = JSON.parse(text);
  } catch (error) {
    throw new Error(`lane ownership file ${filePath} is not valid JSON: ${error.message}`);
  }
  try {
    return validateLaneOwnership(ownership);
  } catch (error) {
    throw new Error(`lane ownership file ${filePath} is invalid: ${error.message}`);
  }
}

export function pathMatchesOwnershipPattern(path, pattern) {
  if (isDirectoryPattern(pattern)) return path.startsWith(pattern.slice(0, -directoryPatternSuffix.length) + "/");
  return path === pattern;
}

export function ownerLaneOfPath(ownership, path) {
  const matchingLanes = Object.entries(ownership.lanes)
    .filter(([, lane]) => lane.owns.some((pattern) => pathMatchesOwnershipPattern(path, pattern)))
    .map(([laneName]) => laneName);
  if (matchingLanes.length > 1) throw new Error(`path claimed by two lanes: ${path} (${matchingLanes.join(", ")})`);
  return matchingLanes[0] ?? ownership.rules.unclaimedPathOwner;
}

export function laneOfPart(ownership, part) {
  const owningLane = Object.entries(ownership.lanes).find(([, lane]) => lane.parts.includes(part));
  if (owningLane === undefined) throw new Error(`part ${part} belongs to no lane`);
  return owningLane[0];
}

export function foreignPathsForLane(ownership, laneName, paths) {
  return paths
    .filter((path) => !ownership.rules.sharedByAllLanes.some((pattern) => pathMatchesOwnershipPattern(path, pattern)))
    .filter((path) => ownerLaneOfPath(ownership, path) !== laneName)
    .sort();
}

function readCommandLineOptions(argumentsAfterScript) {
  const options = new Map();
  for (let index = 0; index < argumentsAfterScript.length; index += 2) {
    const name = argumentsAfterScript[index];
    const value = argumentsAfterScript[index + 1];
    if (name !== "--base" && name !== "--part") throw new Error(`unknown option ${String(name)}; use --base <ref> [--part <slug>]`);
    if (value === undefined) throw new Error(`option ${name} needs a value`);
    options.set(name, value);
  }
  const baseReference = options.get("--base");
  if (baseReference === undefined) throw new Error("missing --base <ref>");
  if (!gitReferencePattern.test(baseReference)) throw new Error(`invalid --base ${baseReference}`);
  return { baseReference, part: options.get("--part") };
}

function laneOfCurrentBranch(ownership, part) {
  if (part !== undefined) return laneOfPart(ownership, part);
  const branchName = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  if (!laneBranchPattern.test(branchName)) return ownership.rules.unclaimedPathOwner;
  const branchPart = branchName.slice(0, branchName.indexOf("/"));
  try {
    return laneOfPart(ownership, branchPart);
  } catch {
    throw new Error(`branch ${branchName} names part ${branchPart}, which belongs to no lane; rename the branch to <part>/<slug> or pass --part <slug>`);
  }
}

function changedPathsSince(baseReference) {
  const output = execFileSync("git", ["diff", "--name-only", `${baseReference}...HEAD`], { encoding: "utf8" });
  return output.split("\n").filter((line) => line.length > 0);
}

function runLaneOwnershipCheck() {
  const { baseReference, part } = readCommandLineOptions(process.argv.slice(2));
  const ownership = readLaneOwnership(laneOwnershipFilePath);
  const laneName = laneOfCurrentBranch(ownership, part);
  const foreignPaths = foreignPathsForLane(ownership, laneName, changedPathsSince(baseReference));
  console.log(`lane ${laneName}: ${foreignPaths.length} foreign paths`);
  for (const path of foreignPaths) console.log(path);
  return foreignPaths.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runLaneOwnershipCheck();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
