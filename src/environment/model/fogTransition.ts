import type { BgraBytes } from "./nativeColourBytes";
import { lowByte, truncateToInt32 } from "../../shared/math/x87IntegerConversion";

export interface FogTransitionState {
  readonly targetColourBgra: BgraBytes;
  readonly targetStart: number;
  readonly targetEnd: number;
  readonly oldColourBgra: BgraBytes;
  readonly oldStart: number;
  readonly oldEnd: number;
  readonly colourBgra: BgraBytes;
  readonly start: number;
  readonly end: number;
  readonly duration: number;
  readonly remaining: number;
}

export function setFogTransitionColourTarget(state: FogTransitionState, colourBgra: BgraBytes): FogTransitionState {
  return { ...state, targetColourBgra: colourBgra };
}

export function setFogTransitionRangeTarget(state: FogTransitionState, start: number, end: number): FogTransitionState {
  return { ...state, targetStart: Math.fround(start), targetEnd: Math.fround(end) };
}

export function setFogTransitionDuration(state: FogTransitionState, seconds: number): FogTransitionState {
  return { ...state, duration: Math.fround(seconds) };
}

export function snapshotFogTransition(state: FogTransitionState): FogTransitionState {
  return { ...state, oldColourBgra: state.colourBgra, oldStart: state.start, oldEnd: state.end, remaining: state.duration };
}

function interpolatedByte(from: number, to: number, amount: number): number {
  return lowByte(truncateToInt32(from + (to - from) * amount));
}

export function updateFogTransition(state: FogTransitionState, deltaSeconds: number): FogTransitionState {
  if (state.remaining <= 0) {
    return { ...state, oldColourBgra: state.targetColourBgra, oldStart: state.targetStart, oldEnd: state.targetEnd, colourBgra: state.targetColourBgra,
      start: state.targetStart, end: state.targetEnd, remaining: 0 };
  }
  const remaining = Math.fround(state.remaining - deltaSeconds);
  const amount = Math.fround(1 - remaining / state.duration);
  const { oldColourBgra: from, targetColourBgra: to } = state;
  return { ...state, remaining,
    start: Math.fround(state.oldStart + (state.targetStart - state.oldStart) * amount), end: Math.fround(state.oldEnd + (state.targetEnd - state.oldEnd) * amount),
    colourBgra: [interpolatedByte(from[0], to[0], amount), interpolatedByte(from[1], to[1], amount), interpolatedByte(from[2], to[2], amount), state.colourBgra[3]] };
}
