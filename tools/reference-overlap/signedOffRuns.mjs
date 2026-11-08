import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ReferenceOverlapSetupError } from "./referenceOverlapSetupError.mjs";

export const defaultSignedOffRunsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "signedOffRuns.json");
const supportedSchemaVersion = 1;
const signedOffVerdict = "generic";
const areasWithoutSignOffs = new Set(["network"]);
const sha256HexPattern = /^[0-9a-f]{64}$/;
const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const signedOffRunFieldNames = ["area", "sourceFile", "tokenCount", "sourceTokensSha256", "referenceFiles", "verdict", "reviewedOn", "review", "evidence"];
const signedOffRunTextFieldNames = ["area", "sourceFile", "sourceTokensSha256", "verdict", "reviewedOn", "review", "evidence"];

export function loadSignedOffRuns(filePath = defaultSignedOffRunsPath) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new ReferenceOverlapSetupError(`cannot read the sign-off file ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ReferenceOverlapSetupError(`sign-off file ${filePath} is not valid JSON: ${error.message}`);
  }
}

function requireSortedUniqueReferenceFiles(referenceFiles, entryLabel) {
  if (!Array.isArray(referenceFiles) || referenceFiles.length === 0 || referenceFiles.some(referenceFile => typeof referenceFile !== "string" || referenceFile === "")) {
    throw new ReferenceOverlapSetupError(`${entryLabel} referenceFiles must be a non-empty list of paths`);
  }
  referenceFiles.forEach((referenceFile, index) => {
    if (index > 0 && referenceFiles[index - 1] >= referenceFile) throw new ReferenceOverlapSetupError(`${entryLabel} referenceFiles must be sorted and unique: ${referenceFile}`);
  });
}

function requireSignedOffRun(entry, entryLabel, areaNames) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new ReferenceOverlapSetupError(`${entryLabel} must be an object`);
  const missingFieldName = signedOffRunFieldNames.find(fieldName => !Object.hasOwn(entry, fieldName));
  if (missingFieldName !== undefined) throw new ReferenceOverlapSetupError(`${entryLabel} is missing the field ${missingFieldName}`);
  const blankFieldName = signedOffRunTextFieldNames.find(fieldName => typeof entry[fieldName] !== "string" || entry[fieldName] === "");
  if (blankFieldName !== undefined) throw new ReferenceOverlapSetupError(`${entryLabel} field ${blankFieldName} must be non-empty text`);
  if (!areaNames.includes(entry.area)) throw new ReferenceOverlapSetupError(`${entryLabel} names unknown area ${entry.area}; use one of ${areaNames.join(", ")}`);
  if (areasWithoutSignOffs.has(entry.area)) {
    throw new ReferenceOverlapSetupError(`${entryLabel} names area ${entry.area}, which takes no sign-offs: NET-09 allows no shared run of 20 or more tokens outside the constant allowlist`);
  }
  if (!Number.isSafeInteger(entry.tokenCount) || entry.tokenCount < 1) throw new ReferenceOverlapSetupError(`${entryLabel} tokenCount must be a positive integer: ${entry.tokenCount}`);
  if (!sha256HexPattern.test(entry.sourceTokensSha256)) throw new ReferenceOverlapSetupError(`${entryLabel} sourceTokensSha256 must be 64 lower-case hex characters: ${entry.sourceTokensSha256}`);
  requireSortedUniqueReferenceFiles(entry.referenceFiles, entryLabel);
  if (entry.verdict !== signedOffVerdict) throw new ReferenceOverlapSetupError(`${entryLabel} verdict must be ${signedOffVerdict}: ${entry.verdict}`);
  if (!calendarDatePattern.test(entry.reviewedOn)) throw new ReferenceOverlapSetupError(`${entryLabel} reviewedOn must be a YYYY-MM-DD date: ${entry.reviewedOn}`);
}

export function validateSignedOffRuns(signedOffRuns, areaNames) {
  if (signedOffRuns === null || typeof signedOffRuns !== "object") throw new ReferenceOverlapSetupError("sign-offs must be an object with schemaVersion and runs");
  if (signedOffRuns.schemaVersion !== supportedSchemaVersion) {
    throw new ReferenceOverlapSetupError(`sign-off schemaVersion ${signedOffRuns.schemaVersion} is not supported; use ${supportedSchemaVersion}`);
  }
  if (!Array.isArray(signedOffRuns.runs)) throw new ReferenceOverlapSetupError("sign-off runs must be a list");
  const signedOffRunKeys = new Set();
  signedOffRuns.runs.forEach((entry, entryIndex) => {
    const entryLabel = `sign-off runs[${entryIndex}]`;
    requireSignedOffRun(entry, entryLabel, areaNames);
    const signedOffRunKey = [entry.area, entry.sourceFile, entry.sourceTokensSha256].join("\u0000");
    if (signedOffRunKeys.has(signedOffRunKey)) {
      throw new ReferenceOverlapSetupError(`${entryLabel} repeats area ${entry.area}, source ${entry.sourceFile} and hash ${entry.sourceTokensSha256}`);
    }
    signedOffRunKeys.add(signedOffRunKey);
  });
  return signedOffRuns.runs;
}

function signedOffRunCoversReviewerRun(signedOffRun, reviewerRun) {
  return signedOffRun.verdict === signedOffVerdict
    && signedOffRun.sourceFile === reviewerRun.sourceFile
    && signedOffRun.tokenCount === reviewerRun.tokenCount
    && signedOffRun.sourceTokensSha256 === reviewerRun.sourceTokensSha256
    && reviewerRun.referenceMatches.every(referenceMatch => signedOffRun.referenceFiles.includes(referenceMatch.referenceFile));
}

export function signOffReviewerRuns(reviewerRuns, validatedSignedOffRuns, areaName) {
  const areaSignedOffRuns = validatedSignedOffRuns.filter(signedOffRun => signedOffRun.area === areaName);
  const signedOffReviewerRuns = reviewerRuns.map(reviewerRun => {
    const signedOffRun = areaSignedOffRuns.find(candidate => signedOffRunCoversReviewerRun(candidate, reviewerRun));
    const signedOff = signedOffRun === undefined ? null : { verdict: signedOffRun.verdict, reviewedOn: signedOffRun.reviewedOn, evidence: signedOffRun.evidence };
    return { ...reviewerRun, signedOff };
  });
  const staleSignedOffRuns = areaSignedOffRuns.filter(signedOffRun => !reviewerRuns.some(reviewerRun => signedOffRunCoversReviewerRun(signedOffRun, reviewerRun)));
  return { reviewerRuns: signedOffReviewerRuns, staleSignedOffRuns };
}
