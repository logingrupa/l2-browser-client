import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COORDINATE_SYSTEM, DIRECTION_USAGE, ROTATION_SOURCE } from "../../src/effects/particles/sim/emitterConstants";
import { parseEmitterRecord, type EmitterSourceRecord, type ParticleEmitterRecord } from "../../src/effects/particles/sim/emitterRecords";
import { CAMERA_FACING_DIRECTION_USAGES, listEmitterFeatureChecks, listUnportedEmitterFeatures } from "../../src/effects/particles/sim/particleEmitter";
import { readSyntheticParticleFixture } from "./support/particleFixtures";

type LeafTest = "is-true" | "is-false" | "is-nonzero" | "at-least" | "equals" | "not-in";
interface LeafCondition {
  readonly test: LeafTest;
  readonly property: string;
  readonly classDefault: boolean;
  readonly value?: number;
  readonly values?: readonly number[];
  readonly constant?: string;
}
interface CompositeCondition { readonly test: "all-of" | "any-of"; readonly conditions: readonly FeatureCondition[] }
type FeatureCondition = LeafCondition | CompositeCondition;
interface FeatureRule { readonly property: string; readonly emitterClasses: readonly string[]; readonly when: FeatureCondition }
interface FeatureCoverageRecipe { readonly schemaVersion: number; readonly listVersion: number; readonly source: string; readonly features: readonly FeatureRule[] }

const recipe = JSON.parse(readFileSync("recipes/actors/emitter-feature-coverage.json", "utf8")) as FeatureCoverageRecipe;
const classFixtures = ["synthetic-sprite", "synthetic-mesh", "synthetic-ribbon"].map(name => readSyntheticParticleFixture(name).components[0]!);
const typeScriptConstants: Readonly<Record<string, unknown>> = { ROTATION_SOURCE, COORDINATE_SYSTEM, DIRECTION_USAGE, CAMERA_FACING_DIRECTION_USAGES };

const isComposite = (condition: FeatureCondition): condition is CompositeCondition => condition.test === "all-of" || condition.test === "any-of";

function leafConditions(condition: FeatureCondition): LeafCondition[] {
  return isComposite(condition) ? condition.conditions.flatMap(leafConditions) : [condition];
}

function resolveTypeScriptConstant(path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => (value as Record<string, unknown> | undefined)?.[segment], typeScriptConstants);
}

function recipeConditionHolds(effectiveProperties: Readonly<Record<string, unknown>>, condition: FeatureCondition): boolean {
  if (isComposite(condition)) {
    const innerHolds = (inner: FeatureCondition) => recipeConditionHolds(effectiveProperties, inner);
    return condition.test === "all-of" ? condition.conditions.every(innerHolds) : condition.conditions.some(innerHolds);
  }
  const booleanTest = condition.test === "is-true" || condition.test === "is-false";
  const value = Object.hasOwn(effectiveProperties, condition.property) ? effectiveProperties[condition.property] : booleanTest ? false : 0;
  switch (condition.test) {
    case "is-true": return value === true;
    case "is-false": return value === false;
    case "is-nonzero": return value !== 0;
    case "at-least": return Number(value) >= condition.value!;
    case "equals": return value === condition.value;
    case "not-in": return !condition.values!.includes(Number(value));
  }
}

function recipeUnportedProperties(source: EmitterSourceRecord): string[] {
  return recipe.features.filter(feature => feature.emitterClasses.includes(source.class!) && recipeConditionHolds(source.effectiveProperties, feature.when))
    .map(feature => feature.property);
}

function candidateValues(condition: LeafCondition): readonly (boolean | number)[] {
  switch (condition.test) {
    case "is-true": case "is-false": return [false, true];
    case "is-nonzero": return [0, 1, 2];
    case "at-least": case "equals": return [condition.value! - 1, condition.value!, condition.value! + 1];
    case "not-in": return [...new Set(condition.values!.flatMap(value => [value - 1, value, value + 1]))];
  }
}

function overrideCombinations(conditions: readonly LeafCondition[]): Record<string, unknown>[] {
  return conditions.reduce<Record<string, unknown>[]>((combinations, condition) =>
    combinations.flatMap(combination => candidateValues(condition).map(value => ({ ...combination, [condition.property]: value }))), [{}]);
}

function withOverrides(source: EmitterSourceRecord, overrides: Record<string, unknown>): EmitterSourceRecord {
  return { ...source, effectiveProperties: { ...source.effectiveProperties, ...overrides } };
}

function parsedOrNull(source: EmitterSourceRecord): ParticleEmitterRecord | null {
  try { return parseEmitterRecord(source); } catch { return null; }
}

function withoutField(source: EmitterSourceRecord, property: string): EmitterSourceRecord {
  const { [property]: _authored, ...properties } = source.properties;
  const { [property]: _effective, ...effectiveProperties } = source.effectiveProperties;
  return { ...source, properties, effectiveProperties };
}

describe("emitter feature coverage recipe mirrors listEmitterFeatureChecks", () => {
  it("is schema version 1 and names the TypeScript owner", () => {
    expect(recipe.schemaVersion).toBe(1);
    expect(recipe.listVersion).toBeGreaterThanOrEqual(1);
    expect(recipe.source).toContain("listEmitterFeatureChecks");
  });

  it.each(classFixtures.map(source => [source.class!, source] as const))("lists the same feature properties in the same order for %s", (_emitterClass, source) => {
    const recipeProperties = recipe.features.filter(feature => feature.emitterClasses.includes(source.class!)).map(feature => feature.property);
    expect(recipeProperties).toEqual(listEmitterFeatureChecks(parseEmitterRecord(source)).map(check => check.property));
  });

  it("takes every compared constant from the TypeScript constant it names", () => {
    const namedConditions = recipe.features.flatMap(feature => leafConditions(feature.when)).filter(condition => condition.constant !== undefined);
    expect(namedConditions.length).toBeGreaterThan(0);
    for (const condition of namedConditions) {
      expect(condition.values ?? condition.value, `${condition.property} ${condition.constant}`).toEqual(resolveTypeScriptConstant(condition.constant!));
    }
  });

  it("marks exactly the fields parseEmitterRecord requires as Interlude class defaults", () => {
    for (const feature of recipe.features) {
      const source = classFixtures.find(fixture => feature.emitterClasses.includes(fixture.class!))!;
      for (const condition of leafConditions(feature.when)) {
        const parse = () => parseEmitterRecord(withoutField(source, condition.property));
        if (condition.classDefault) expect(parse, condition.property).toThrow(`field ${condition.property} has no Interlude class default`);
        else expect(parse(), condition.property).toMatchObject({ provenanceByField: { [condition.property]: "ue-zero" } });
      }
    }
  });

  it.each(recipe.features.map(feature => [feature.property, feature] as const))("gives the runtime verdict for every synthetic %s record of every class", (_property, feature) => {
    let unportedCases = 0, portedCases = 0;
    for (const fixture of classFixtures) {
      for (const overrides of overrideCombinations(leafConditions(feature.when))) {
        const source = withOverrides(fixture, overrides), record = parsedOrNull(source);
        if (record === null) continue;
        const runtimeProperties = listUnportedEmitterFeatures(record).map(unported => unported.property);
        expect(recipeUnportedProperties(source), `${fixture.class} ${JSON.stringify(overrides)}`).toEqual(runtimeProperties);
        if (feature.emitterClasses.includes(fixture.class!)) {
          if (runtimeProperties.includes(feature.property)) unportedCases += 1; else portedCases += 1;
        }
      }
    }
    expect(unportedCases).toBeGreaterThan(0);
    expect(portedCases).toBeGreaterThan(0);
  });

  it("gives the runtime verdict for a record with every feature unported at once", () => {
    for (const fixture of classFixtures) {
      const everyFeatureOn = recipe.features.filter(feature => feature.emitterClasses.includes(fixture.class!)).reduce<Record<string, unknown>>((overrides, feature) => {
        const unported = overrideCombinations(leafConditions(feature.when)).find(candidate => recipeConditionHolds({ ...fixture.effectiveProperties, ...overrides, ...candidate }, feature.when)
          && parsedOrNull(withOverrides(fixture, { ...overrides, ...candidate })) !== null);
        return { ...overrides, ...unported };
      }, {});
      const source = withOverrides(fixture, everyFeatureOn);
      const runtimeProperties = listUnportedEmitterFeatures(parseEmitterRecord(source)).map(unported => unported.property);
      expect(runtimeProperties).toEqual(recipe.features.filter(feature => feature.emitterClasses.includes(fixture.class!)).map(feature => feature.property));
      expect(recipeUnportedProperties(source)).toEqual(runtimeProperties);
    }
  });
});
