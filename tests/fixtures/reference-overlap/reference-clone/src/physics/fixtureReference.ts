interface SampleState {
  readonly speed: number;
  readonly push: number;
  readonly place: number;
}

let sampleCount = 0;

function stepSample(sample: SampleState, deltaTime: number): SampleState {
  const nextSpeed = sample.speed + sample.push * deltaTime;
  const nextPlace = sample.place + nextSpeed * deltaTime;
  return { speed: nextSpeed, push: sample.push, place: nextPlace };
}

sampleCount += 1;

function wrapAngle(angle: number) {
  return (angle + 2048) & 4095;
}

sampleCount += 2;

const replyCodes = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112];

export { replyCodes, sampleCount, stepSample, wrapAngle };
