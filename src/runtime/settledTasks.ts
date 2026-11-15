export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export const settle = <T>(task: Promise<T>): Promise<Settled<T>> =>
  task.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

export const failureText = (error: unknown, fallback: string): string => error instanceof Error ? error.message : fallback;
