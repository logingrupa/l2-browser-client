import { TEXTURE_FRAME_CONSTANTS } from "./constants/textureFrameConstants";

export interface AnimationChainFrames {
  readonly kind: "anim-next";
  readonly frameCount: number;
  readonly maximumFrameRate: number;
}

export interface MaterialSequenceFrames {
  readonly kind: "material-sequence";
  readonly displaySeconds: readonly number[];
  readonly loop: boolean;
}

export type TextureFrameSource = AnimationChainFrames | MaterialSequenceFrames;

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

function selectAnimationChainFrame(source: AnimationChainFrames, levelSeconds: number): SelectedTextureFrame {
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

function selectMaterialSequenceFrame(source: MaterialSequenceFrames, levelSeconds: number): SelectedTextureFrame {
  requireFrames(source.displaySeconds.length >= 1, "a material sequence needs at least one entry.");
  requireFrames(source.displaySeconds.every(seconds => Number.isFinite(seconds) && seconds >= 0), "display times must be finite and non-negative.");
  const cycleSeconds = source.displaySeconds.reduce((total, seconds) => total + seconds, 0);
  if (cycleSeconds === 0) return { index: 0, phaseSeconds: 0, cycleSeconds };
  const phaseSeconds = source.loop ? levelSeconds % cycleSeconds : Math.min(levelSeconds, cycleSeconds);
  let elapsedSeconds = 0;
  for (const [index, seconds] of source.displaySeconds.entries()) {
    elapsedSeconds += seconds;
    if (phaseSeconds < elapsedSeconds) return { index, phaseSeconds, cycleSeconds };
  }
  return { index: source.displaySeconds.length - 1, phaseSeconds, cycleSeconds };
}

export function selectTextureFrame(source: TextureFrameSource, levelSeconds: number): SelectedTextureFrame {
  requireFrames(Number.isFinite(levelSeconds) && levelSeconds >= 0, `level time ${levelSeconds} must be finite and non-negative.`);
  return source.kind === "anim-next" ? selectAnimationChainFrame(source, levelSeconds) : selectMaterialSequenceFrame(source, levelSeconds);
}
