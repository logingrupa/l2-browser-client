export interface MaterialSwatchParameters {
  readonly materialId: string;
  readonly levelSeconds: number;
  readonly hour: number;
  readonly environmentType: number;
}

export class MaterialSwatchParameterError extends Error {
  override readonly name = "MaterialSwatchParameterError";
}

const materialIdPattern = /^[a-f0-9]{64}$/;
const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const hoursPerDay = 24;
const maximumLevelSeconds = 1_000_000;

function requiredParameter(query: URLSearchParams, name: string): string {
  const values = query.getAll(name);
  if (values.length !== 1 || values[0] === "") throw new MaterialSwatchParameterError(`Material swatch needs exactly one ?${name}= value.`);
  return values[0]!;
}

function decimalParameter(query: URLSearchParams, name: string, upperBound: number, upperInclusive: boolean): number {
  const text = requiredParameter(query, name);
  if (!decimalPattern.test(text)) throw new MaterialSwatchParameterError(`?${name}=${text} is not a non-negative decimal number.`);
  const value = Number(text);
  if (!Number.isFinite(value) || (upperInclusive ? value > upperBound : value >= upperBound)) {
    throw new MaterialSwatchParameterError(`?${name}=${text} lies outside 0 to ${upperBound}.`);
  }
  return value;
}

export function readMaterialSwatchParameters(search: string): MaterialSwatchParameters {
  const query = new URLSearchParams(search);
  const materialId = requiredParameter(query, "material");
  if (!materialIdPattern.test(materialId)) throw new MaterialSwatchParameterError(`?material=${materialId} is not a material program SHA-256.`);
  const environment = requiredParameter(query, "environment");
  if (!/^(?:0|[1-9][0-9]?)$/.test(environment)) throw new MaterialSwatchParameterError(`?environment=${environment} is not an environment type index.`);
  return {
    materialId,
    levelSeconds: decimalParameter(query, "levelSeconds", maximumLevelSeconds, true),
    hour: decimalParameter(query, "hour", hoursPerDay, false),
    environmentType: Number(environment),
  };
}
