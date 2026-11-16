export interface EnvironmentTransitionWindow {
  readonly start: number;
  readonly end: number;
  readonly peak: number;
  readonly targetWeight: number;
}

export function calculateEnvironmentDelta(transitionWindow: EnvironmentTransitionWindow, hour: number): number {
  const { start, end, peak, targetWeight } = transitionWindow;
  if (hour < start) return targetWeight;
  if (hour > end) return targetWeight;
  if (hour < peak) return Math.fround((hour - start) / (peak - start));
  if (hour === peak) return 1;
  if (targetWeight === 1) return 1;
  const fallSpan = Math.fround((end - peak) * (targetWeight / (1 - targetWeight) + 1));
  return Math.fround(1 - (hour - peak) / fallSpan);
}
