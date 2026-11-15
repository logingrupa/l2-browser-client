import { createHash } from "node:crypto";

const sourceTokenSeparator = "\u0001";
const referenceFileSeparator = "\n";

function sha256OfText(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function sha256OfSourceTokens(sourceTokens) {
  return sha256OfText(sourceTokens.map(token => token.original).join(sourceTokenSeparator));
}

export function sha256OfReferenceFiles(referenceFiles) {
  return sha256OfText([...new Set(referenceFiles)].sort().join(referenceFileSeparator));
}
