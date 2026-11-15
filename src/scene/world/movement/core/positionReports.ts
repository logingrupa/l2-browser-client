import type { Vector3 } from "../../../../shared/math/vector3";
import type { MovementNativeRules } from "./movementRules";

export interface ProgressAnchor {
  readonly location: Vector3;
  readonly seconds: number;
}

export interface PositionReportState {
  readonly lastReportSeconds: number | null;
  readonly movingAtLastReport: boolean;
  readonly progressAnchor: ProgressAnchor | null;
}

export interface PositionReportSample {
  readonly nowSeconds: number;
  readonly location: Vector3;
  readonly isMoving: boolean;
}

export type PositionReportKind = "report-position" | "cannot-move";

export interface PositionReportOutcome {
  readonly state: PositionReportState;
  readonly reports: readonly PositionReportKind[];
}

export const INITIAL_POSITION_REPORT_STATE: PositionReportState = { lastReportSeconds: null, movingAtLastReport: false, progressAnchor: null };

const distanceBetween = (left: Vector3, right: Vector3) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);

function checkProgress(anchor: ProgressAnchor | null, sample: PositionReportSample, rules: MovementNativeRules): { anchor: ProgressAnchor | null; isStuck: boolean } {
  if (!sample.isMoving) return { anchor: null, isStuck: false };
  const currentAnchor = { location: sample.location, seconds: sample.nowSeconds };
  if (anchor === null) return { anchor: currentAnchor, isStuck: false };
  if (sample.nowSeconds - anchor.seconds < rules.reports.stuckSeconds) return { anchor, isStuck: false };
  if (distanceBetween(sample.location, anchor.location) < rules.reports.stuckDistance) return { anchor: null, isStuck: true };
  return { anchor: currentAnchor, isStuck: false };
}

export function advancePositionReports(state: PositionReportState, sample: PositionReportSample, rules: MovementNativeRules): PositionReportOutcome {
  const progress = checkProgress(state.progressAnchor, sample, rules);
  const isMoving = sample.isMoving && !progress.isStuck;
  const reports: PositionReportKind[] = progress.isStuck ? ["cannot-move"] : [];
  if (!isMoving && !state.movingAtLastReport) return { state: { ...state, progressAnchor: progress.anchor }, reports };
  if (state.lastReportSeconds === null) {
    return { state: { lastReportSeconds: sample.nowSeconds, movingAtLastReport: isMoving, progressAnchor: progress.anchor }, reports };
  }
  if (sample.nowSeconds - state.lastReportSeconds < rules.reports.cadenceSeconds) return { state: { ...state, progressAnchor: progress.anchor }, reports };
  return {
    state: { lastReportSeconds: sample.nowSeconds, movingAtLastReport: isMoving, progressAnchor: progress.anchor },
    reports: [...reports, "report-position"],
  };
}
