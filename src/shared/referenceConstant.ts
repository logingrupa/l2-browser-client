export type ReferenceConstantStatus = "ue2-data" | "unconfirmed" | "confirmed-interlude" | "corrected-interlude" | "unknown";

export interface ReferenceConstantRow<Value> {
  readonly id: string;
  readonly value: Value;
  readonly provenance: string;
  readonly status: ReferenceConstantStatus;
  readonly interludeEvidence: string | null;
  readonly runtimeDefault: Value;
}
