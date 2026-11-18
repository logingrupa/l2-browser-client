import type { NativeMaterial } from "../../materials/ue2/babylon/material";
import { composeLocalSkyColour } from "../../environment/model/localSkyColourComposition";
import type { RgbBytes } from "../../environment/model/sampleNativeTimeTables";
import type { SkyEnvironmentBinding } from "../../environment/parseNativeTimeTables";
import type { RetainedFogInfoList } from "./cameraEnvironment";
import type { SkyEnvironmentColour } from "./worldTimeOfDay";

export interface SkyEnvironmentColourSurface {
  readonly nativeMaterial: NativeMaterial;
  readonly colorModifierNodes: readonly string[];
}

export type SkyMaterialColourSource = "environment-write" | "held-environment-write" | "authored-colour";

export interface SkyEnvironmentColourSources {
  readonly tableColours: () => readonly SkyEnvironmentColour[];
  readonly retainedFogInfos: () => RetainedFogInfoList;
}

export interface SkyEnvironmentColourInspection extends SkyEnvironmentBinding {
  readonly materialNode: string | null;
  readonly tableRgb: RgbBytes | null;
  readonly localFogInfoCount: number;
  readonly writtenRgb: RgbBytes | null;
  readonly materialColourSource: SkyMaterialColourSource;
  readonly reason: string | null;
}

export interface SkyEnvironmentColourWriter {
  write(): void;
  inspection(): readonly SkyEnvironmentColourInspection[];
}

interface SkyEnvironmentColourTarget {
  readonly binding: SkyEnvironmentBinding;
  readonly materialNode: string | null;
  readonly surfaces: readonly { readonly surface: SkyEnvironmentColourSurface; readonly node: string }[];
}

const skyEnvironmentMaterialAbsentReason = "sky-environment-material-absent";
const byteMaximum = 255;

function unrealNameIdentity(name: string): string {
  return name.toLowerCase();
}

function objectNameOf(objectPath: string): string {
  return objectPath.slice(objectPath.lastIndexOf(".") + 1);
}

function resolveTarget(surfaces: readonly SkyEnvironmentColourSurface[], binding: SkyEnvironmentBinding): SkyEnvironmentColourTarget {
  const objectName = unrealNameIdentity(binding.objectName);
  const matches = surfaces.flatMap(surface => surface.colorModifierNodes.filter(node => unrealNameIdentity(objectNameOf(node)) === objectName)
    .map(node => ({ surface, node })));
  const distinctNodes = [...new Set(matches.map(match => unrealNameIdentity(match.node)))];
  if (distinctNodes.length > 1) {
    throw new Error(`Sky environment binding ${binding.setupKey}=${binding.objectName} matches ${distinctNodes.length} ColorModifier objects: ${distinctNodes.join(", ")}.`);
  }
  return { binding, materialNode: matches[0]?.node ?? null, surfaces: matches };
}

interface SkyColourComposition {
  readonly tableRgb: RgbBytes | null;
  readonly localFogInfoCount: number;
}

const uncomposed: SkyColourComposition = { tableRgb: null, localFogInfoCount: 0 };

function inspectionOf(target: SkyEnvironmentColourTarget, composition: SkyColourComposition, writtenRgb: RgbBytes | null,
  materialColourSource: SkyMaterialColourSource, reason: string | null): SkyEnvironmentColourInspection {
  return { ...target.binding, materialNode: target.materialNode, ...composition, writtenRgb, materialColourSource, reason };
}

function writeResolvedColour(target: SkyEnvironmentColourTarget, rgb: RgbBytes): void {
  const rgbUnits = [rgb[0] / byteMaximum, rgb[1] / byteMaximum, rgb[2] / byteMaximum] as const;
  for (const { surface, node } of target.surfaces) surface.nativeMaterial.overrideColourSourceRgb(node, rgbUnits);
}

function heldInspection(target: SkyEnvironmentColourTarget, previous: SkyEnvironmentColourInspection, composition: SkyColourComposition,
  reason: string): SkyEnvironmentColourInspection {
  if (previous.writtenRgb === null) return inspectionOf(target, composition, null, "authored-colour", reason);
  return inspectionOf(target, composition, previous.writtenRgb, "held-environment-write", reason);
}

export function bindSkyEnvironmentColours(surfaces: readonly SkyEnvironmentColourSurface[], sources: SkyEnvironmentColourSources): SkyEnvironmentColourWriter {
  const targets = sources.tableColours().map(({ colour: _colour, ...binding }) => resolveTarget(surfaces, binding));
  let inspections = targets.map(target => inspectionOf(target, uncomposed, null, "authored-colour",
    target.materialNode === null ? skyEnvironmentMaterialAbsentReason : null));
  return {
    write() {
      const colours = sources.tableColours();
      if (colours.length !== targets.length || colours.some((entry, index) => entry.setupKey !== targets[index]!.binding.setupKey)) {
        throw new Error("The sky environment bindings changed after the sky materials were bound.");
      }
      const retained = sources.retainedFogInfos();
      inspections = colours.map((entry, index) => {
        const target = targets[index]!;
        if (target.materialNode === null) return inspectionOf(target, uncomposed, null, "authored-colour", skyEnvironmentMaterialAbsentReason);
        if (entry.colour.status !== "resolved") return heldInspection(target, inspections[index]!, uncomposed, entry.colour.reason);
        const tableComposition: SkyColourComposition = { tableRgb: entry.colour.value, localFogInfoCount: 0 };
        if (retained.status === "unresolved") return heldInspection(target, inspections[index]!, tableComposition, retained.reason);
        const rgb = composeLocalSkyColour(entry.colour.value, entry.section, retained.fogInfos, retained.hour);
        writeResolvedColour(target, rgb);
        return inspectionOf(target, { ...tableComposition, localFogInfoCount: retained.fogInfos.length }, rgb, "environment-write", null);
      });
    },
    inspection: () => inspections,
  };
}
