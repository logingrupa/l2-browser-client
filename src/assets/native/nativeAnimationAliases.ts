export const requiredNativeAliases = ["idle", "run", "attack", "death"] as const;

export type NativeAliasGroup = "locomotion" | "combat" | "magic" | "rest" | "death" | "swim" | "social";

export const nativeAnimationAliases = [
  { alias: "idle", field: "WaitAnimName", group: "locomotion" },
  { alias: "walk", field: "WalkAnimName", group: "locomotion" },
  { alias: "run", field: "RunAnimName", group: "locomotion" },
  { alias: "turn", field: "TurnAnimName", group: "locomotion" },
  { alias: "atkWait", field: "AtkWaitAnimName", group: "combat" },
  { alias: "attack", field: "Atk01AnimName", group: "combat" },
  { alias: "atk02", field: "Atk02AnimName", group: "combat" },
  { alias: "atk03", field: "Atk03AnimName", group: "combat" },
  { alias: "shieldAtk", field: "ShieldAtkAnimName", group: "combat" },
  { alias: "castShort", field: "CastShortAnimName", group: "magic" },
  { alias: "castMid", field: "CastMidAnimName", group: "magic" },
  { alias: "castLong", field: "CastLongAnimName", group: "magic" },
  { alias: "castEnd", field: "CastEndAnimName", group: "magic" },
  { alias: "magicShot", field: "MagicShotAnimName", group: "magic" },
  { alias: "magicThrow", field: "MagicThrowAnimName", group: "magic" },
  { alias: "magicNoTarget", field: "MagicNoTargetAnimName", group: "magic" },
  { alias: "sit", field: "SitAnimName", group: "rest" },
  { alias: "sitWait", field: "SitWaitAnimName", group: "rest" },
  { alias: "stand", field: "StandAnimName", group: "rest" },
  { alias: "chairSit", field: "ChairSitAnimName", group: "rest" },
  { alias: "chairWait", field: "ChairWaitAnimName", group: "rest" },
  { alias: "chairStand", field: "ChairStandAnimName", group: "rest" },
  { alias: "pickup", field: "PicItemAnimName", group: "rest" },
  { alias: "death", field: "DeathAnimName", group: "death" },
  { alias: "deathWait", field: "DeathWaitAnimName", group: "death" },
  { alias: "deathStand", field: "DeathStandAnimName", group: "death" },
  { alias: "damage", field: "DamageAnimName", group: "death" },
  { alias: "damageFly", field: "DamageFlyAnimName", group: "death" },
  { alias: "fall", field: "FallAnimName", group: "death" },
  { alias: "swim", field: "SwimAnimName", group: "swim" },
  { alias: "swimWait", field: "SwimWaitAnimName", group: "swim" },
  { alias: "swimAtkWait", field: "SwimAtkWaitAnimName", group: "swim" },
  { alias: "swimDeath", field: "SwimDeathAnimName", group: "swim" },
  { alias: "swimDeathWait", field: "SwimDeathWaitAnimName", group: "swim" },
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(index => ({ alias: `social${index}`, field: "PcSocialAnimName", group: "social" as const })),
] as const satisfies readonly { alias: string; field: string; group: NativeAliasGroup }[];

export type NativeRequiredAlias = typeof requiredNativeAliases[number];
export type NativeAnimationAlias = typeof nativeAnimationAliases[number]["alias"];
export type NativePlayerClips = Readonly<Record<NativeRequiredAlias, string>> & Readonly<Partial<Record<NativeAnimationAlias, string>>>;

const aliasSet: ReadonlySet<string> = new Set(nativeAnimationAliases.map(row => row.alias));
export function isNativeAnimationAlias(value: string): value is NativeAnimationAlias { return aliasSet.has(value); }

export const boundAliasStatuses = ["exact", "case-only"] as const;
export const unboundAliasStatuses = ["no-family-value", "no-native-field", "missing-clip", "conflict-unresolved", "ambiguous", "unsupported-syntax"] as const;
export type NativeAliasStatus = typeof boundAliasStatuses[number] | typeof unboundAliasStatuses[number];

export interface NativeAliasEvidenceRow {
  readonly alias: NativeAnimationAlias;
  readonly key: string;
  readonly status: NativeAliasStatus;
  readonly reference?: string;
  readonly line?: number;
  readonly selectionPath?: string;
  readonly reason?: string;
}

export interface NativeAliasEvidence {
  readonly generator: string;
  readonly report: string;
  readonly reportSha256: string;
  readonly family: string;
  readonly familySource: string;
  readonly familySourceSha256: string;
  readonly rows: readonly NativeAliasEvidenceRow[];
}

export type NativeAliasCoverageStatus = NativeAliasStatus | "authored-override" | "no-evidence";

export interface NativeAliasCoverageRow {
  readonly alias: NativeAnimationAlias;
  readonly group: NativeAliasGroup;
  readonly field: string;
  readonly key: string;
  readonly nativeClip: string | null;
  readonly clip: string | null;
  readonly status: NativeAliasCoverageStatus;
  readonly reason: string | null;
  readonly summary: string | null;
  readonly reference: string | null;
  readonly line: number | null;
  readonly selectionPath: string | null;
}

export interface NativeAliasCoverage {
  readonly bound: number;
  readonly total: number;
  readonly rows: readonly NativeAliasCoverageRow[];
}

const unboundSummaries: Readonly<Record<string, string>> = {
  "no-family-value": "not assigned in this class section",
  "no-native-field": "no native field",
  "missing-clip": "named clip not in the package",
  "conflict-unresolved": "conflicting source rows",
  ambiguous: "ambiguous clip match",
  "unsupported-syntax": "unsupported source syntax",
  "no-evidence": "no staged alias evidence",
};

function summarizeMissingHitReactionClip(rows: NativeAliasCoverageRow[]): void {
  const damage = rows.findIndex(row => row.alias === "damage"), damageFly = rows.find(row => row.alias === "damageFly");
  if (damage >= 0 && rows[damage]!.summary !== null && rows[damage]!.status !== "no-evidence") {
    rows[damage] = { ...rows[damage]!, summary: `Interlude has no hit-reaction clip; DamageFly = knock-back${damageFly?.nativeClip ? ` (${damageFly.nativeClip})` : ""}` };
  }
}

export function nativeAliasCoverage(clips: NativePlayerClips, evidence: NativeAliasEvidence | undefined,
  clipsPlayedBySemanticState: Readonly<Partial<Record<string, string>>> = clips): NativeAliasCoverage {
  const rows: NativeAliasCoverageRow[] = [];
  const evidenceRows = new Map((evidence?.rows ?? []).map(row => [row.alias, row]));
  for (const definition of nativeAnimationAliases) {
    const row = evidenceRows.get(definition.alias);
    const native = clips[definition.alias] ?? null, played = clipsPlayedBySemanticState[definition.alias] ?? native;
    const key = row?.key ?? (definition.field === "PcSocialAnimName" ? `PcSocialAnimName[${definition.alias.slice(6)}]` : `${definition.field}[0]`);
    const status: NativeAliasCoverageStatus = !row ? "no-evidence" : played !== null && native !== null && played !== native ? "authored-override" : row.status;
    const unbound = native === null && played === null;
    const reason = row?.reason ?? (unbound ? "This profile carries no staged alias evidence (scripts/prepare-native-player-aliases.py → stage_native_players.py)." : null);
    rows.push({ alias: definition.alias, group: definition.group, field: definition.field, key, nativeClip: native, clip: played,
      status, reason, summary: unbound ? unboundSummaries[row?.status ?? "no-evidence"] ?? "no native clip" : null,
      reference: row?.reference ?? null, line: row?.line ?? null, selectionPath: row?.selectionPath ?? null });
  }
  summarizeMissingHitReactionClip(rows);
  return { bound: rows.filter(row => row.summary === null).length, total: rows.length, rows };
}

export function nativeAliasCoverageText(coverage: NativeAliasCoverage): string {
  return `${coverage.bound} of ${coverage.total} aliases`;
}
