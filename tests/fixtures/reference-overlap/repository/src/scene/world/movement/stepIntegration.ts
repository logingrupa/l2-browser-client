export interface FixtureBody {
  readonly velocity: number;
  readonly acceleration: number;
  readonly position: number;
}

export function advanceFixtureBody(body: FixtureBody, elapsedSeconds: number): FixtureBody {
  const nextVelocity = body.velocity + body.acceleration * elapsedSeconds;
  const nextPosition = body.position + nextVelocity * elapsedSeconds;
  return { velocity: nextVelocity, acceleration: body.acceleration, position: nextPosition };
}
