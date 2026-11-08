import { sha256 } from "../assets/package/readAssetPackage";
import { nativeResourceUrl } from "../assets/native/nativeResourceUrl";
import { readNativeCatalog } from "../assets/native/readNativeCatalog";

export type NativeCombatRole = "attackItem" | "attackVoice" | "defense" | "damage" | "cast" | "shot" | "critical" | "soulshot";
type OriginalTableString = string;
type AdmittedCorpusExport = string;
export type NativeCombatSelectionKind = "actor" | "armor" | "weapon" | "skill" | "config";

export interface NativeCombatSlot {
  readonly index: number;
  readonly reference: OriginalTableString;
  readonly object: AdmittedCorpusExport;
  readonly status: "exact-identity" | "unique-package-leaf-candidate";
  readonly sourcePointer: string;
  readonly key: string;
}
export interface NativeCombatSoundSet {
  readonly selection: string;
  readonly table: string;
  readonly field: string;
  readonly slots: readonly NativeCombatSlot[];
  readonly unadmitted: readonly { index: number; reference: string | null; status: string }[];
}
export interface NativeCombatSelection {
  readonly id: string;
  readonly kind: NativeCombatSelectionKind;
  readonly label: string;
  readonly table: string;
  readonly rowOrdinal: number;
  readonly catalogId?: string;
  readonly sourceObject?: string;
  readonly itemId?: number;
  readonly skillId?: number;
  readonly level?: number;
  readonly numeric: Readonly<Record<string, number>>;
  readonly roles: Readonly<Partial<Record<NativeCombatRole, NativeCombatSoundSet>>>;
}
export interface NativeCombatAudioBundle {
  readonly id: string;
  readonly manifestSha256: string;
  readonly selections: readonly NativeCombatSelection[];
  readonly sounds: readonly { key: string; bytes: Uint8Array }[];
}

const hash = /^[a-f0-9]{64}$/;
const objectName = /^[A-Za-z_][A-Za-z_0-9-]*(?:\.[A-Za-z_][A-Za-z_0-9-]*)+$/;
const roleNames = new Set<NativeCombatRole>(["attackItem", "attackVoice", "defense", "damage", "cast", "shot", "critical", "soulshot"]);
const kinds = new Set<NativeCombatSelectionKind>(["actor", "armor", "weapon", "skill", "config"]);
const admitted = new Set(["exact-identity", "unique-package-leaf-candidate"]);

function requireMatch(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function object(value: unknown): Record<string, unknown> {
  requireMatch(value && typeof value === "object" && !Array.isArray(value), "Invalid combat-audio record");
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = 512): string {
  requireMatch(typeof value === "string" && value.length > 0 && value.length <= limit, "Invalid combat-audio identity"); return value;
}
function list(value: unknown, limit: number): unknown[] {
  requireMatch(Array.isArray(value) && value.length <= limit, "Invalid combat-audio list"); return value;
}
const integer = (value: unknown): value is number => Number.isSafeInteger(value);

async function resource(path: string, expectedHash: string, size: number, signal: AbortSignal, fetcher: typeof fetch): Promise<Uint8Array> {
  requireMatch(hash.test(expectedHash) && Number.isSafeInteger(size) && size > 0 && size <= 8_000_000, "Invalid combat-audio resource pin");
  const response = await fetcher(nativeResourceUrl(path), { signal });
  requireMatch(response.ok, `Combat audio request returned ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  requireMatch(bytes.length === size && await sha256(bytes) === expectedHash, "Combat-audio resource hash/length mismatch");
  signal.throwIfAborted(); return bytes;
}

function groupLessReferenceAgreesWithAdmittedExport(reference: string, exported: string): boolean {
  const left = reference.toLowerCase().split("."), right = exported.toLowerCase().split(".");
  if (left.length === right.length) return left.join(".") === right.join(".");
  return left.length === 2 && right.length >= 3 && left[0] === right[0] && left[1] === right.at(-1);
}

export function parseNativeCombatManifest(raw: unknown, manifestSha256: string, id = "native-combat-audio") {
  const manifest = object(raw);
  requireMatch(manifest.schemaVersion === 1 && manifest.kind === "native-combat-audio-dependencies", "Unsupported combat-audio bundle");
  const sounds = new Map<string, { file: string; bytes: number; sha256: string; object: string; key: string }>();
  for (const value of list(manifest.sounds, 4096)) {
    const sound = object(value), dependencyId = text(sound.dependencyId), sha = text(sound.sha256), source = object(sound.source);
    const packageHash = text(source.packageSha256), sourceObject = text(source.object);
    requireMatch(!sounds.has(dependencyId) && hash.test(sha) && hash.test(packageHash) && sound.file === `audio/${sha}.wav` &&
      sound.mime === "audio/wav" && integer(sound.bytes) && sound.bytes > 0 && sound.bytes <= 8_000_000 &&
      integer(source.exportIndex) && source.exportIndex > 0 && dependencyId.endsWith(`:${packageHash}:${source.exportIndex}`) &&
      objectName.test(sourceObject), "Invalid or duplicated combat sound dependency");
    sounds.set(dependencyId, { file: sound.file as string, bytes: sound.bytes as number, sha256: sha, object: sourceObject, key: `native-combat:${sha}` });
  }
  const selections: NativeCombatSelection[] = [], identities = new Set<string>(), needed = new Set<string>();
  for (const value of list(manifest.selections, 64)) {
    const row = object(value), selectionId = text(row.id, 80), kind = row.kind as NativeCombatSelectionKind, table = text(row.table, 32);
    requireMatch(!identities.has(selectionId) && kinds.has(kind) && integer(row.rowOrdinal) && row.rowOrdinal >= 0, "Invalid combat selection");
    identities.add(selectionId);
    const roles: Partial<Record<NativeCombatRole, NativeCombatSoundSet>> = {};
    for (const [role, rawSet] of Object.entries(object(row.roles))) {
      requireMatch(roleNames.has(role as NativeCombatRole), "Unsupported combat role");
      const set = object(rawSet), field = text(set.field, 64), slots: NativeCombatSlot[] = [], unadmitted: NativeCombatSoundSet["unadmitted"][number][] = [];
      list(set.slots, 64).forEach((rawSlot, position) => {
        const slot = object(rawSlot), status = text(slot.status, 64);
        requireMatch(slot.index === position && (slot.reference === null || typeof slot.reference === "string"), "Combat slot order differs");
        if (slot.dependencyId === null || slot.dependencyId === undefined) {
          unadmitted.push({ index: position, reference: slot.reference as string | null, status }); return;
        }
        const sound = sounds.get(text(slot.dependencyId)), reference = text(slot.reference);
        requireMatch(sound && admitted.has(status) && groupLessReferenceAgreesWithAdmittedExport(reference, sound.object), "Combat slot reference differs from its admitted dependency");
        needed.add(slot.dependencyId as string);
        slots.push({ index: position, reference, object: sound.object, status: status as NativeCombatSlot["status"],
          sourcePointer: text(slot.sourcePointer, 256), key: sound.key });
      });
      roles[role as NativeCombatRole] = { selection: selectionId, table, field, slots, unadmitted };
    }
    const numeric: Record<string, number> = {};
    for (const [field, number] of Object.entries(row.numeric === undefined ? {} : object(row.numeric))) {
      requireMatch(typeof number === "number" && Number.isFinite(number), "Invalid combat numeric field"); numeric[field] = number;
    }
    selections.push({ id: selectionId, kind, label: typeof row.label === "string" ? row.label : selectionId, table, rowOrdinal: row.rowOrdinal as number,
      ...(typeof row.catalogId === "string" ? { catalogId: row.catalogId } : {}),
      ...(typeof row.sourceObject === "string" ? { sourceObject: row.sourceObject } : {}),
      ...(integer(row.itemId) ? { itemId: row.itemId } : {}), ...(integer(row.skillId) ? { skillId: row.skillId } : {}),
      ...(integer(row.level) ? { level: row.level } : {}), numeric, roles });
  }
  return { id, manifestSha256, selections, needed: [...needed].map(dependency => sounds.get(dependency)!) };
}

export async function loadNativeCombatAudio(signal: AbortSignal,
  options: { id?: string; fetch?: typeof fetch } = {}): Promise<NativeCombatAudioBundle | null> {
  const fetcher = options.fetch ?? fetch, id = options.id ?? "native-combat-audio";
  const { combatAudio } = await readNativeCatalog(signal, fetcher);
  const records = list(combatAudio, 8);
  const matches = records.map(object).filter(entry => entry.id === id);
  requireMatch(matches.length <= 1, "Combat-audio catalog identity is duplicated");
  if (!matches.length) return null;
  const entry = matches[0]!, manifestHash = text(entry.manifestSha256), prefix = `/l2/combat-audio/${manifestHash}/`;
  requireMatch(hash.test(manifestHash) && entry.manifest === `${prefix}manifest.json`, "Invalid combat-audio catalog entry");
  const bytes = await resource(`${prefix}manifest.json`, manifestHash, Number(entry.manifestBytes), signal, fetcher);
  const parsed = parseNativeCombatManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), manifestHash, id);
  const sounds = await Promise.all(parsed.needed.map(async sound =>
    ({ key: sound.key, bytes: await resource(prefix + sound.file, sound.sha256, sound.bytes, signal, fetcher) })));
  signal.throwIfAborted();
  return { id: parsed.id, manifestSha256: manifestHash, selections: parsed.selections, sounds };
}
