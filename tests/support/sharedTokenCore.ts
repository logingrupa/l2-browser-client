import { findSharedTokenRuns, normaliseSourceTokens } from "../../tools/reference-overlap/referenceOverlap.mjs";

export function alternatingCoreText(tokenCount: number, identifierPrefix: string, replacedNumberIndex: number | null = null): string {
  return Array.from({ length: tokenCount }, (_, index) => {
    if (index % 2 === 0) return `${identifierPrefix}${index}`;
    return String(index === replacedNumberIndex ? 9000 + index : 1000 + index);
  }).join(" ");
}

export function sharedRunLengths(sourceText: string, referenceText: string, minimumRun: number): number[] {
  return findSharedTokenRuns(normaliseSourceTokens(sourceText), normaliseSourceTokens(referenceText), minimumRun).map(run => run.tokenCount);
}

export function sourceAndReferenceWithSharedCore(tokenCount: number): { sourceText: string; referenceText: string } {
  return {
    sourceText: `7001 ${alternatingCoreText(tokenCount, "alpha")} 7002`,
    referenceText: `8001 ${alternatingCoreText(tokenCount, "beta")} 8002`,
  };
}
