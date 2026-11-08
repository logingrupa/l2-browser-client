export interface SourceToken {
  readonly normalised: string;
  readonly original: string;
  readonly line: number;
}

export interface SharedTokenRun {
  readonly sourceStart: number;
  readonly referenceStart: number;
  readonly tokenCount: number;
}

export interface ReferenceClone {
  readonly name: string;
  readonly path: string;
  readonly commit: string;
}

export interface AllowlistedConstant {
  readonly sourceFile: string;
  readonly constantName: string;
  readonly kind: string;
}

export interface OverlapArea {
  readonly sourceGlobs: readonly string[];
  readonly referenceGlobs: readonly string[];
  readonly constantAllowlist: readonly AllowlistedConstant[];
}

export interface OverlapAreas {
  readonly schemaVersion: number;
  readonly thresholds: { readonly reviewerRunTokens: number; readonly blockingRunTokens: number };
  readonly referenceClones: readonly ReferenceClone[];
  readonly areas: Readonly<Record<string, OverlapArea>>;
}

export interface ReferenceMatch {
  readonly referenceFile: string;
  readonly referenceStartLine: number;
  readonly referenceEndLine: number;
}

export interface SignedOffRun {
  readonly area: string;
  readonly sourceFile: string;
  readonly tokenCount: number;
  readonly sourceTokensSha256: string;
  readonly referenceFiles: readonly string[];
  readonly verdict: string;
  readonly reviewedOn: string;
  readonly review: string;
  readonly evidence: string;
}

export interface SignedOffRuns {
  readonly schemaVersion: number;
  readonly runs: readonly SignedOffRun[];
}

export interface ReviewerSignOff {
  readonly verdict: string;
  readonly reviewedOn: string;
  readonly evidence: string;
}

export interface ReviewerRun {
  readonly sourceFile: string;
  readonly sourceStartLine: number;
  readonly sourceEndLine: number;
  readonly tokenCount: number;
  readonly sourceTokensSha256: string;
  readonly allowlistedConstant: { readonly constantName: string; readonly kind: string } | null;
  readonly referenceMatches: readonly ReferenceMatch[];
  readonly signedOff: ReviewerSignOff | null;
}

export interface ReferenceOverlapReport {
  readonly area: string;
  readonly referenceCommits: Readonly<Record<string, string>>;
  readonly thresholds: { readonly reviewerRunTokens: number; readonly blockingRunTokens: number };
  readonly sourceFiles: readonly string[];
  readonly referenceFileCount: number;
  readonly reviewerRuns: readonly ReviewerRun[];
  readonly signedOffRunCount: number;
  readonly staleSignedOffRuns: readonly SignedOffRun[];
  readonly blockingRuns: readonly ReviewerRun[];
}

export interface ReferenceOverlapOptions {
  readonly area: string;
  readonly repositoryRoot?: string;
  readonly referenceRoot?: string;
  readonly overlapAreas?: OverlapAreas;
  readonly signedOffRuns?: SignedOffRuns;
}

export class ReferenceOverlapSetupError extends Error {}
export function normaliseSourceTokens(text: string): SourceToken[];
export function findSharedTokenRuns(sourceTokens: readonly Pick<SourceToken, "normalised" | "original">[], referenceTokens: readonly Pick<SourceToken, "normalised" | "original">[], minimumRun: number): SharedTokenRun[];
export function loadOverlapAreas(): OverlapAreas;
export function runReferenceOverlap(options: ReferenceOverlapOptions): ReferenceOverlapReport;
