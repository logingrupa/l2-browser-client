import { TEXTURE_FRAME_CONSTANTS } from "./constants/textureFrameConstants";

export interface AnimationChainFrames {
  readonly frameCount: number;
  readonly maximumFrameRate: number;
}

export interface SelectedTextureFrame {
  readonly index: number;
  readonly phaseSeconds: number;
  readonly cycleSeconds: number;
}

const [minimumFrameRate, maximumFrameRate] = TEXTURE_FRAME_CONSTANTS.frameRateRange.runtimeDefault;
const maximumSignedInteger = 0x7fffffff;

function requireFrames(condition: boolean, message: string): asserts condition {
  if (!condition) throw new RangeError(`Texture frames: ${message}`);
}

export function selectTextureFrame(source: AnimationChainFrames, levelSeconds: number): SelectedTextureFrame {
  requireFrames(Number.isFinite(levelSeconds) && levelSeconds >= 0, `level time ${levelSeconds} must be finite and non-negative.`);
  requireFrames(Number.isInteger(source.frameCount) && source.frameCount >= 1, `frame count ${source.frameCount} must be a positive integer.`);
  requireFrames(Number.isFinite(source.maximumFrameRate), "MaxFrameRate must be finite.");
  const stepSeconds = 1 / Math.min(maximumFrameRate, Math.max(minimumFrameRate, source.maximumFrameRate));
  const cycleSeconds = source.frameCount * stepSeconds;
  const wholeCycles = levelSeconds / cycleSeconds;
  requireFrames(wholeCycles <= maximumSignedInteger, "level time exceeds the signed whole-cycle range.");
  const phaseSeconds = levelSeconds - Math.trunc(wholeCycles) * cycleSeconds;
  let remainingSeconds = phaseSeconds, index = 0;
  for (let tick = 0; remainingSeconds >= stepSeconds; tick += 1) {
    requireFrames(tick <= source.frameCount, "the frame phase exceeds one cycle.");
    index = (index + 1) % source.frameCount;
    remainingSeconds -= stepSeconds;
  }
  return { index, phaseSeconds, cycleSeconds };
}
