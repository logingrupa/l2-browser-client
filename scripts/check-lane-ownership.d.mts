export interface LaneRecord {
  title: string;
  parts: string[];
  owns: string[];
}

export interface LaneOwnershipRules {
  maximumParallelLanes: number;
  branchPattern: string;
  unclaimedPathOwner: string;
  sharedByAllLanes: string[];
}

export interface LaneOwnership {
  schemaVersion: 1;
  rules: LaneOwnershipRules;
  lanes: Record<string, LaneRecord>;
}

export function readLaneOwnership(filePath: string): LaneOwnership;
export function validateLaneOwnership(ownership: unknown): LaneOwnership;
export function pathMatchesOwnershipPattern(path: string, pattern: string): boolean;
export function ownerLaneOfPath(ownership: LaneOwnership, path: string): string;
export function laneOfPart(ownership: LaneOwnership, part: string): string;
export function foreignPathsForLane(ownership: LaneOwnership, laneName: string, paths: readonly string[]): string[];
