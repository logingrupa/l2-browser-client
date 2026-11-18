export interface Rm1ReferencePawn {
  readonly tileId: "15_22" | "20_21";
  readonly referenceCapture: string;
  readonly referencePawnSourcePosition: { readonly x: number; readonly y: number; readonly z: number };
  readonly referencePawnHeadingUnits: number;
  readonly gameMinutes: number;
}

export const rm1ReferencePawn20_21: Rm1ReferencePawn = {
  tileId: "20_21", referenceCapture: "RM-1 reference-map-captures-rm1.json 20_21 shots[0] playerLocation, playerRotation and gameHour 12.30 in whole minutes",
  referencePawnSourcePosition: { x: 9181.810546875, y: 119378.65625, z: -3673.308349609375 }, referencePawnHeadingUnits: 0, gameMinutes: 738,
};

export const rm1ReferencePawn15_22: Rm1ReferencePawn = {
  tileId: "15_22", referenceCapture: "RM-1 reference-map-captures-rm1.json 15_22 shots[0] playerLocation, playerRotation and gameHour 12.078 in whole minutes",
  referencePawnSourcePosition: { x: -144885.09375, y: 137792.125, z: -3300 }, referencePawnHeadingUnits: 2675, gameMinutes: 725,
};
