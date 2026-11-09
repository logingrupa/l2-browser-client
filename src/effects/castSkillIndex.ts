export interface SkillEffectComponentIdentity { readonly skillId: number; readonly level: number }
export interface CastSkillRecord { readonly id: string; readonly skillId: number; readonly level: number; readonly entry: Readonly<Record<string, unknown>> }
export type CastSkillIndex = ReadonlyMap<string, CastSkillRecord>;

const skillEffectComponentIdPattern = /^interlude:skill:(0|[1-9]\d{0,8}):level:([1-9]\d{0,3}):.+$/;
const selectedSkillParameterPattern = /^(0|[1-9]\d{0,8}):([1-9]\d{0,3})$/;
export const reviewedPowerStrikeSkill: SkillEffectComponentIdentity = { skillId: 3, level: 1 };

const castSkillKey = (skillId: number, level: number) => `skill:${skillId}:${level}`;
const isEntry = (value: unknown): value is Readonly<Record<string, unknown>> & { readonly id: string } =>
  typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string";

export function parseSkillEffectComponentId(id: string): SkillEffectComponentIdentity | null {
  const match = skillEffectComponentIdPattern.exec(id);
  return match ? { skillId: Number(match[1]), level: Number(match[2]) } : null;
}

export function buildCastSkillIndex(effectComponentRecords: readonly unknown[]): CastSkillIndex {
  const index = new Map<string, CastSkillRecord>();
  for (const entry of effectComponentRecords) {
    if (!isEntry(entry)) throw new Error("Cast skill index: an effect component record has no string id.");
    const identity = parseSkillEffectComponentId(entry.id);
    if (identity === null) continue;
    const key = castSkillKey(identity.skillId, identity.level);
    const existing = index.get(key);
    if (existing) throw new Error(`Cast skill index: ${key} has two effect component records, ${existing.id} and ${entry.id}.`);
    index.set(key, { id: entry.id, ...identity, entry });
  }
  return index;
}

export function lookupCastSkill(index: CastSkillIndex, skillId: number, level: number): CastSkillRecord | null {
  return index.get(castSkillKey(skillId, level)) ?? null;
}

export function selectedCastSkill(location: Pick<Location, "search"> | undefined): SkillEffectComponentIdentity | null {
  if (!location) return null;
  const values = new URLSearchParams(location.search).getAll("skill");
  if (values.length !== 1) return null;
  const match = selectedSkillParameterPattern.exec(values[0]!);
  return match ? { skillId: Number(match[1]), level: Number(match[2]) } : null;
}
