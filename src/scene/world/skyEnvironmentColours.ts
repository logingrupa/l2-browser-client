import type { NativeMaterial } from "../../materials/ue2/babylon/material";
import type { RgbBytes } from "../../environment/model/sampleNativeTimeTables";
import type { SkyEnvironmentBinding } from "../../environment/parseNativeTimeTables";
import type { SkyEnvironmentColour } from "./worldTimeOfDay";

export interface SkyEnvironmentColourSurface {
  readonly nativeMaterial: NativeMaterial;
  readonly colorModifierNodes: readonly string[];
}

export type SkyMaterialColourSource = "environment-write" | "held-environment-write" | "authored-colour";

export interface SkyEnvironmentColourInspection extends SkyEnvironmentBinding {
  readonly materialNode: string | null;
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

function inspectionOf(target: SkyEnvironmentColourTarget, writtenRgb: RgbBytes | null, materialColourSource: SkyMaterialColourSource,
  reason: string | null): SkyEnvironmentColourInspection {
  return { ...target.binding, materialNode: target.materialNode, writtenRgb, materialColourSource, reason };
}

function writeResolvedColour(target: SkyEnvironmentColourTarget, rgb: RgbBytes): void {
  const rgbUnits = [rgb[0] / byteMaximum, rgb[1] / byteMaximum, rgb[2] / byteMaximum] as const;
  for (const { surface, node } of target.surfaces) surface.nativeMaterial.overrideColourSourceRgb(node, rgbUnits);
}

function heldInspection(target: SkyEnvironmentColourTarget, previous: SkyEnvironmentColourInspection, reason: string): SkyEnvironmentColourInspection {
  if (previous.writtenRgb === null) return inspectionOf(target, null, "authored-colour", reason);
  return inspectionOf(target, previous.writtenRgb, "held-environment-write", reason);
}

export function bindSkyEnvironmentColours(surfaces: readonly SkyEnvironmentColourSurface[],
  readColours: () => readonly SkyEnvironmentColour[]): SkyEnvironmentColourWriter {
  const targets = readColours().map(({ colour: _colour, ...binding }) => resolveTarget(surfaces, binding));
  let inspections = targets.map(target => inspectionOf(target, null, "authored-colour", target.materialNode === null ? skyEnvironmentMaterialAbsentReason : null));
  return {
    write() {
      const colours = readColours();
      if (colours.length !== targets.length || colours.some((entry, index) => entry.setupKey !== targets[index]!.binding.setupKey)) {
        throw new Error("The sky environment bindings changed after the sky materials were bound.");
      }
      inspections = colours.map((entry, index) => {
        const target = targets[index]!;
        if (target.materialNode === null) return inspectionOf(target, null, "authored-colour", skyEnvironmentMaterialAbsentReason);
        if (entry.colour.status !== "resolved") return heldInspection(target, inspections[index]!, entry.colour.reason);
        writeResolvedColour(target, entry.colour.value);
        return inspectionOf(target, entry.colour.value, "environment-write", null);
      });
    },
    inspection: () => inspections,
  };
}
