export type BlendFactor =
  | "zero"
  | "one"
  | "source-colour"
  | "inverse-source-colour"
  | "source-alpha"
  | "inverse-source-alpha"
  | "destination-colour";

export interface BlendFactorPair {
  readonly source: BlendFactor;
  readonly destination: BlendFactor;
}

export type FogFamily = "fog-colour" | "black" | "neutral-grey" | "none";
