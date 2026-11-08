import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ReferenceOverlapSetupError } from "./referenceOverlapSetupError.mjs";

export const defaultReviewedRunsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "reviewedRuns");
const supportedSchemaVersion = 1;
const reviewedRunFieldNames = ["tokenCount", "sourceTokensSha256", "referenceFilesSha256", "escalated", "reason"];
const reviewedRunsFileExtension = ".json";
const sha256HexPattern = /^[0-9a-f]{64}$/;
const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function loadReviewedRuns(directory = defaultReviewedRunsDirectory) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new ReferenceOverlapSetupError(`reviewed-runs directory absent: ${directory}`);
  const reviewedRunFiles = {};
  for (const fileName of readdirSync(directory).filter(entryName => entryName.endsWith(reviewedRunsFileExtension)).sort()) {
    const filePath = path.join(directory, fileName);
    try {
      reviewedRunFiles[fileName.slice(0, -reviewedRunsFileExtension.length)] = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new ReferenceOverlapSetupError(`reviewed-runs file ${filePath} is not valid JSON: ${error.message}`);
    }
  }
  return reviewedRunFiles;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reviewedRunKey(sourceFile, tokenCount, sourceTokensSha256, referenceFilesSha256) {
  return [sourceFile, tokenCount, sourceTokensSha256, referenceFilesSha256].join("\u0000");
}

function requireReviewedRunRow(row, rowLabel) {
  if (!Array.isArray(row) || row.length !== reviewedRunFieldNames.length) {
    throw new ReferenceOverlapSetupError(`${rowLabel} must be a list of ${reviewedRunFieldNames.length} fields: ${reviewedRunFieldNames.join(", ")}`);
  }
  const [tokenCount, sourceTokensSha256, referenceFilesSha256, escalated, reason] = row;
  if (!Number.isSafeInteger(tokenCount) || tokenCount < 1) throw new ReferenceOverlapSetupError(`${rowLabel} tokenCount must be a positive integer: ${tokenCount}`);
  for (const [fieldName, hash] of [["sourceTokensSha256", sourceTokensSha256], ["referenceFilesSha256", referenceFilesSha256]]) {
    if (typeof hash !== "string" || !sha256HexPattern.test(hash)) throw new ReferenceOverlapSetupError(`${rowLabel} ${fieldName} must be 64 lower-case hex characters: ${hash}`);
  }
  if (typeof escalated !== "boolean") throw new ReferenceOverlapSetupError(`${rowLabel} escalated must be true or false: ${escalated}`);
  if (typeof reason !== "string" || reason.trim() === "") throw new ReferenceOverlapSetupError(`${rowLabel} reason must be non-empty text`);
  return { tokenCount, sourceTokensSha256, referenceFilesSha256, escalated, reason };
}

function readReview(review, reviewLabel) {
  if (!isPlainObject(review)) throw new ReferenceOverlapSetupError(`${reviewLabel} must be an object with reviewedOn, method and files`);
  if (typeof review.reviewedOn !== "string" || !calendarDatePattern.test(review.reviewedOn)) {
    throw new ReferenceOverlapSetupError(`${reviewLabel} reviewedOn must be a YYYY-MM-DD date: ${review.reviewedOn}`);
  }
  if (typeof review.method !== "string" || review.method.trim() === "") throw new ReferenceOverlapSetupError(`${reviewLabel} method must be non-empty text`);
  if (!isPlainObject(review.files)) throw new ReferenceOverlapSetupError(`${reviewLabel} files must map each source file to its rows`);
  return Object.entries(review.files).flatMap(([sourceFile, rows]) => {
    if (sourceFile === "" || !Array.isArray(rows) || rows.length === 0) throw new ReferenceOverlapSetupError(`${reviewLabel} files.${sourceFile} must be a non-empty list of rows`);
    return rows.map((row, rowIndex) => ({ sourceFile, ...requireReviewedRunRow(row, `${reviewLabel} files.${sourceFile}[${rowIndex}]`), reviewedOn: review.reviewedOn }));
  });
}

function readReviewedRunsFile(reviewedRunsFile, fileArea, areaNames) {
  const fileLabel = `reviewed-runs file ${fileArea}${reviewedRunsFileExtension}`;
  if (!areaNames.includes(fileArea)) throw new ReferenceOverlapSetupError(`${fileLabel} names unknown area ${fileArea}; use one of ${areaNames.join(", ")}`);
  if (!isPlainObject(reviewedRunsFile)) throw new ReferenceOverlapSetupError(`${fileLabel} must be an object`);
  if (reviewedRunsFile.schemaVersion !== supportedSchemaVersion) {
    throw new ReferenceOverlapSetupError(`${fileLabel} schemaVersion ${reviewedRunsFile.schemaVersion} is not supported; use ${supportedSchemaVersion}`);
  }
  if (reviewedRunsFile.area !== fileArea) throw new ReferenceOverlapSetupError(`${fileLabel} names area ${reviewedRunsFile.area}, which does not match its file name`);
  if (JSON.stringify(reviewedRunsFile.runFields) !== JSON.stringify(reviewedRunFieldNames)) {
    throw new ReferenceOverlapSetupError(`${fileLabel} runFields must be ${reviewedRunFieldNames.join(", ")}`);
  }
  if (!Array.isArray(reviewedRunsFile.reviews) || reviewedRunsFile.reviews.length === 0) throw new ReferenceOverlapSetupError(`${fileLabel} reviews must be a non-empty list`);
  const reviewedRunKeys = new Set();
  return reviewedRunsFile.reviews.flatMap((review, reviewIndex) => readReview(review, `${fileLabel} reviews[${reviewIndex}]`)).map(reviewedRun => {
    const key = reviewedRunKey(reviewedRun.sourceFile, reviewedRun.tokenCount, reviewedRun.sourceTokensSha256, reviewedRun.referenceFilesSha256);
    if (reviewedRunKeys.has(key)) {
      throw new ReferenceOverlapSetupError(`${fileLabel} repeats the row for ${reviewedRun.sourceFile} with ${reviewedRun.tokenCount} tokens and hash ${reviewedRun.sourceTokensSha256}`);
    }
    reviewedRunKeys.add(key);
    return reviewedRun;
  });
}

export function validateReviewedRuns(reviewedRunFiles, areaNames) {
  if (!isPlainObject(reviewedRunFiles)) throw new ReferenceOverlapSetupError("reviewed runs must map each area file name to its contents");
  return new Map(Object.entries(reviewedRunFiles).map(([fileArea, reviewedRunsFile]) => [fileArea, readReviewedRunsFile(reviewedRunsFile, fileArea, areaNames)]));
}

export function markReviewedRuns(reviewerRuns, areaReviewedRuns) {
  const reviewedRunsByKey = new Map(areaReviewedRuns.map(reviewedRun => [
    reviewedRunKey(reviewedRun.sourceFile, reviewedRun.tokenCount, reviewedRun.sourceTokensSha256, reviewedRun.referenceFilesSha256), reviewedRun,
  ]));
  const matchedKeys = new Set();
  const markedReviewerRuns = reviewerRuns.map(reviewerRun => {
    const key = reviewedRunKey(reviewerRun.sourceFile, reviewerRun.tokenCount, reviewerRun.sourceTokensSha256, reviewerRun.referenceFilesSha256);
    const reviewedRun = reviewedRunsByKey.get(key);
    if (reviewedRun !== undefined) matchedKeys.add(key);
    return { ...reviewerRun, reviewed: reviewedRun === undefined ? null : { reviewedOn: reviewedRun.reviewedOn } };
  });
  const staleReviewedRuns = [...reviewedRunsByKey].filter(([key]) => !matchedKeys.has(key)).map(([, reviewedRun]) => reviewedRun);
  return { reviewerRuns: markedReviewerRuns, staleReviewedRuns };
}
