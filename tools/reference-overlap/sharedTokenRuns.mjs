import { identifierPlaceholder } from "./sourceTokens.mjs";

const identifierCode = 0;
const freshIdentifierValue = -1;

function encodeTokenSequence(tokens, codeByNormalisedText) {
  const codes = new Int32Array(tokens.length);
  const identifierBackDistances = new Int32Array(tokens.length);
  const lastIndexByIdentifier = new Map();
  tokens.forEach((token, index) => {
    if (token.normalised === identifierPlaceholder) {
      const previousIndex = lastIndexByIdentifier.get(token.original);
      identifierBackDistances[index] = previousIndex === undefined ? 0 : index - previousIndex;
      lastIndexByIdentifier.set(token.original, index);
      codes[index] = identifierCode;
      return;
    }
    if (!codeByNormalisedText.has(token.normalised)) codeByNormalisedText.set(token.normalised, codeByNormalisedText.size + 1);
    codes[index] = codeByNormalisedText.get(token.normalised);
  });
  return { codes, identifierBackDistances, length: tokens.length };
}

function valueInRun(sequence, index, runStart) {
  const code = sequence.codes[index];
  if (code !== identifierCode) return code;
  const backDistance = sequence.identifierBackDistances[index];
  return backDistance !== 0 && backDistance <= index - runStart ? freshIdentifierValue - backDistance : freshIdentifierValue;
}

function windowHash(sequence, runStart, windowLength) {
  let hash = 0x811c9dc5;
  for (let offset = 0; offset < windowLength; offset += 1) hash = Math.imul(hash ^ valueInRun(sequence, runStart + offset, runStart), 0x01000193) >>> 0;
  return hash;
}

function sharedLength(source, sourceStart, reference, referenceStart) {
  let tokenCount = 0;
  while (sourceStart + tokenCount < source.length && referenceStart + tokenCount < reference.length
    && valueInRun(source, sourceStart + tokenCount, sourceStart) === valueInRun(reference, referenceStart + tokenCount, referenceStart)) tokenCount += 1;
  return tokenCount;
}

function indexReferenceWindows(reference, windowLength) {
  const referenceStartsByHash = new Map();
  for (let referenceStart = 0; referenceStart + windowLength <= reference.length; referenceStart += 1) {
    const hash = windowHash(reference, referenceStart, windowLength);
    const starts = referenceStartsByHash.get(hash);
    if (starts === undefined) referenceStartsByHash.set(hash, [referenceStart]);
    else starts.push(referenceStart);
  }
  return referenceStartsByHash;
}

export function findSharedTokenRuns(sourceTokens, referenceTokens, minimumRun) {
  if (!Number.isInteger(minimumRun) || minimumRun < 1) throw new RangeError(`minimumRun must be a positive integer: ${minimumRun}`);
  const codeByNormalisedText = new Map();
  const reference = encodeTokenSequence(referenceTokens, codeByNormalisedText);
  const source = encodeTokenSequence(sourceTokens, codeByNormalisedText);
  const referenceStartsByHash = indexReferenceWindows(reference, minimumRun);
  const runs = [];
  for (let sourceStart = 0; sourceStart + minimumRun <= source.length; sourceStart += 1) {
    for (const referenceStart of referenceStartsByHash.get(windowHash(source, sourceStart, minimumRun)) ?? []) {
      const tokenCount = sharedLength(source, sourceStart, reference, referenceStart);
      if (tokenCount < minimumRun) continue;
      const earlierRunCoversThisOne = sourceStart > 0 && referenceStart > 0 && sharedLength(source, sourceStart - 1, reference, referenceStart - 1) > tokenCount;
      if (!earlierRunCoversThisOne) runs.push({ sourceStart, referenceStart, tokenCount });
    }
  }
  return runs;
}
