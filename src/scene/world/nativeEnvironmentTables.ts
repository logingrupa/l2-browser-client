import { sha256 } from "../../assets/package/readAssetPackage";
import { nativeResourceUrl } from "../../assets/native/nativeResourceUrl";

/** Exact converted source records. These pins select data, not an environment,
 * native clock, interpolation rule, color transfer or default sky appearance. */
export const nativeEnvironmentSource = {
  conversionManifestSha256: "e10827c4e98daeed18062c9e85117a1f862a3e6dfcaad08638798f887081183d",
  tablesSha256: "1dd8e88620ded38cc47e092fe68056dc2e12c3f8d1fdc2e2f7dad281c009151d",
  tablesBytes: 232991,
} as const;

export const skyEnvironmentBindings = [
  { setup: "SKYBOX", section: "SkyBoxColor", material: "l2_skies.Shaders.SkybackgroundColor" },
  { setup: "HAZERING", section: "HazeringColor", material: "l2_skies.Shaders.HazeRing_Final" },
  { setup: "CLOUD1", section: "CloudColor1", material: "l2_skies.Shaders.Cloud_Final" },
] as const;

export interface NativeEnvironmentRow {
  key: string; tLiteral: number; rgb: [number, number, number]; typed: true;
  recordIndex: number; sourceOffset: number; valueSourceOffset: number; rawValue: string;
}
export interface NativeEnvironmentTable {
  file: string; originalSha256: string; decodedSha256: string; section: string; sectionIndex: number;
  declaredNum: number | null; physicalColorRows: number; declaredNumMatchesPhysicalRows: boolean;
  rows: NativeEnvironmentRow[];
}
export interface NativeEnvironmentTables {
  schemaVersion: 1; kind: "native-environment-source-tables"; typedComplete: true;
  tableCount: number; physicalColorRows: number; tables: NativeEnvironmentTable[];
  envSetupDeclarations: { file: string; section: string; key: string; valueAscii: string | null; sourceOffset: number }[];
  anomalies: unknown[]; duplicateSectionHeaders: unknown[];
}
export interface NativeSkyLiteral {
  file: string; key: string; tLiteral: number;
  layers: { material: string; table: string; sectionIndex: number; originalSha256: string; decodedSha256: string;
    declaredNum: number | null; physicalColorRows: number; declaredNumMatchesPhysicalRows: boolean;
    row: NativeEnvironmentRow }[];
}

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function require(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export function parseNativeEnvironmentTables(value: unknown): NativeEnvironmentTables {
  const data = object(value);
  require(data.schemaVersion === 1 && data.kind === "native-environment-source-tables" && data.typedComplete === true &&
    Array.isArray(data.tables) && data.tables.length > 0 && data.tableCount === data.tables.length &&
    Array.isArray(data.envSetupDeclarations) && Array.isArray(data.anomalies) && Array.isArray(data.duplicateSectionHeaders), "Unsupported environment source tables.");
  let rows = 0;
  for (const candidate of data.tables) {
    const table = object(candidate);
    require(typeof table.file === "string" && /^timeenv[0-9]+\.int$/.test(table.file) &&
      hash(table.originalSha256) && hash(table.decodedSha256) && typeof table.section === "string" && integer(table.sectionIndex) &&
      (table.declaredNum === null || integer(table.declaredNum)) && Array.isArray(table.rows) &&
      table.physicalColorRows === table.rows.length && typeof table.declaredNumMatchesPhysicalRows === "boolean", "Invalid environment table identity/count.");
    require(table.declaredNumMatchesPhysicalRows === (table.declaredNum === table.physicalColorRows), "Inconsistent declared environment count.");
    for (const candidateRow of table.rows) {
      const row = object(candidateRow);
      require(row.typed === true && typeof row.key === "string" && /^COLOR[0-9]+$/.test(row.key) && integer(row.tLiteral) &&
        Array.isArray(row.rgb) && row.rgb.length === 3 && row.rgb.every(channel => integer(channel) && channel <= 255) &&
        integer(row.recordIndex) && integer(row.sourceOffset) && integer(row.valueSourceOffset) && typeof row.rawValue === "string", "Invalid literal environment color row.");
    }
    rows += table.rows.length;
  }
  require(data.physicalColorRows === rows, "Environment row coverage mismatch.");
  for (const candidate of data.envSetupDeclarations) {
    const entry = object(candidate);
    require(entry.file === "Env.int" && entry.section === "EnvSetup" && typeof entry.key === "string" &&
      (entry.valueAscii === null || typeof entry.valueAscii === "string") && integer(entry.sourceOffset), "Invalid environment setup identity.");
  }
  // Preserve ordered declarations and anomalies. No map/last-key-wins collapse.
  return structuredClone(data) as unknown as NativeEnvironmentTables;
}

export async function loadNativeEnvironmentTables(signal: AbortSignal): Promise<NativeEnvironmentTables> {
  signal.throwIfAborted();
  const path = `/l2/environments/${nativeEnvironmentSource.conversionManifestSha256}/sky-tables.json`;
  const response = await fetch(nativeResourceUrl(path), { signal });
  if (!response.ok) throw new Error(`Environment comparison source returned HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer()); signal.throwIfAborted();
  require(bytes.length === nativeEnvironmentSource.tablesBytes && await sha256(bytes) === nativeEnvironmentSource.tablesSha256,
    "Environment comparison source hash/length mismatch.");
  signal.throwIfAborted();
  return parseNativeEnvironmentTables(JSON.parse(new TextDecoder().decode(bytes)));
}

/** Match three physical rows by explicit key and equal T literal. This is a
 * comparison grouping convention, never NUM precedence or interpolation. */
export function selectNativeSkyLiteral(data: NativeEnvironmentTables, file: string, key: string): NativeSkyLiteral {
  const layers = skyEnvironmentBindings.map(binding => {
    const declarations = data.envSetupDeclarations.filter(entry => entry.key === binding.setup);
    require(declarations.length === 1 && declarations[0]!.valueAscii === binding.material.split(".").at(-1), "Ambiguous or changed environment/material binding.");
    const tables = data.tables.filter(table => table.file === file && table.section === binding.section);
    require(tables.length === 1, `Missing or ambiguous ${file}/${binding.section} table.`);
    const table = tables[0]!, matches = table.rows.filter(row => row.key === key);
    require(matches.length === 1, `Missing or ambiguous ${file}/${binding.section}/${key} row.`);
    return { material: binding.material, table: table.section, sectionIndex: table.sectionIndex,
      originalSha256: table.originalSha256, decodedSha256: table.decodedSha256, declaredNum: table.declaredNum,
      physicalColorRows: table.physicalColorRows, declaredNumMatchesPhysicalRows: table.declaredNumMatchesPhysicalRows,
      row: structuredClone(matches[0]!) };
  });
  const tLiteral = layers[0]!.row.tLiteral;
  require(layers.every(layer => layer.row.tLiteral === tLiteral), "Selected physical rows have different T literals.");
  return { file, key, tLiteral, layers };
}
