/** Native Human animation aliases: profile keys for Engine.Pawn localized
 * animation fields (WT_HAND family, index 0) and the PcSocialAnimName slots.
 *
 * Bindings and their evidence are never written here. They come from
 * scripts/prepare-native-player-aliases.py, which reads the verified
 * scripts/report-native-animation-aliases.py coverage report, and are staged
 * into the player profile manifest by scripts/stage_native_players.py.
 * scripts/stage_native_players.py keeps the same key list (PLAYER_ALIASES). */

export const requiredNativeAliases = ["idle", "run", "attack", "death"] as const;

export type NativeAliasGroup = "locomotion" | "combat" | "magic" | "rest" | "death" | "swim" | "social";

/** Ordered for display. `field` is the Engine.Pawn localized array the alias reads. */
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

/** Report statuses. exact/case-only bind a clip; the others leave the alias empty with a reason. */
export const boundAliasStatuses = ["exact", "case-only"] as const;
export const unboundAliasStatuses = ["no-family-value", "no-native-field", "missing-clip", "conflict-unresolved", "ambiguous", "unsupported-syntax"] as const;
export type NativeAliasStatus = typeof boundAliasStatuses[number] | typeof unboundAliasStatuses[number];

export interface NativeAliasEvidenceRow {
  readonly alias: NativeAnimationAlias;
  /** Native localized key, e.g. WaitAnimName[0] or PcSocialAnimName[2]. */
  readonly key: string;
  readonly status: NativeAliasStatus;
  /** Localized value as written in LineageWarrior.int, and its line. */
  readonly reference?: string;
  readonly line?: number;
  /** base-class-direct-getter (reviewed Engine.Pawn getter) or unverified. */
  readonly selectionPath?: string;
  readonly reason?: string;
}

export interface NativeAliasEvidence {
  readonly generator: string;
  readonly report: string;
  readonly reportSha256: string;
  readonly family: string;
  /** Localized family document: the package's animation-families.json, or the
   * report's conflict-preserving document when the converter refused one. */
  readonly familySource: string;
  readonly familySourceSha256: string;
  readonly rows: readonly NativeAliasEvidenceRow[];
}

export interface NativeAliasCoverageRow {
  readonly alias: NativeAnimationAlias;
  readonly group: NativeAliasGroup;
  readonly field: string;
  readonly key: string;
  /** Clip that plays for this alias in the browser, or null. */
  readonly clip: string | null;
  /** Clip the native evidence binds, when the browser plays a different (authored) one. */
  readonly nativeClip: string | null;
  readonly status: NativeAliasStatus | "authored-override" | "no-evidence";
  readonly reason: string | null;
  readonly reference: string | null;
  readonly line: number | null;
  readonly selectionPath: string | null;
}

export interface NativeAliasCoverage {
  readonly bound: number;
  readonly total: number;
  readonly rows: readonly NativeAliasCoverageRow[];
}

/** Per-alias coverage for one profile. `effective` is what the browser plays
 * (the Editor's saved male clips override the four core aliases). */
export function nativeAliasCoverage(clips: NativePlayerClips, evidence: NativeAliasEvidence | undefined,
  effective: Readonly<Partial<Record<string, string>>> = clips): NativeAliasCoverage {
  const rows: NativeAliasCoverageRow[] = [];
  const evidenceRows = new Map((evidence?.rows ?? []).map(row => [row.alias, row]));
  for (const definition of nativeAnimationAliases) {
    const row = evidenceRows.get(definition.alias);
    if (!row && !evidence && clips[definition.alias] === undefined) continue;
    const native = clips[definition.alias] ?? null, played = effective[definition.alias] ?? native;
    const key = row?.key ?? (definition.field === "PcSocialAnimName" ? `PcSocialAnimName[${definition.alias.slice(6)}]` : `${definition.field}[0]`);
    const status = !row ? "no-evidence" : played !== null && native !== null && played !== native ? "authored-override" : row.status;
    rows.push({ alias: definition.alias, group: definition.group, field: definition.field, key, clip: played,
      nativeClip: native, status, reason: row?.reason ?? null, reference: row?.reference ?? null,
      line: row?.line ?? null, selectionPath: row?.selectionPath ?? null });
  }
  return { bound: rows.filter(row => row.clip !== null).length, total: rows.length, rows };
}
