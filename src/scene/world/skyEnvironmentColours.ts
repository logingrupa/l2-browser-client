import type { NativeMaterial } from "../../materials/ue2/babylon/material";
import type { RgbBytes } from "../../environment/model/sampleNativeTimeTables";
import type { SkyEnvironmentBinding } from "../../environment/parseNativeTimeTables";
import type { SkyEnvironmentColour } from "./worldTimeOfDay";

export interface SkyEnvironmentColourSurface {
  readonly nativeMaterial: NativeMaterial;
  readonly colorModifierNodes: readonly string[];
}

export interface SkyEnvironmentColourInspection extends SkyEnvironmentBinding {
  readonly materialNode: string | null;
  readonly writtenRgb: RgbBytes | null;
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

function inspectionOf(target: SkyEnvironmentColourTarget, writtenRgb: RgbBytes | null, reason: string | null): SkyEnvironmentColourInspection {
  return { ...target.binding, materialNode: target.materialNode, writtenRgb, reason };
}

export function bindSkyEnvironmentColours(surfaces: readonly SkyEnvironmentColourSurface[],
  readColours: () => readonly SkyEnvironmentColour[]): SkyEnvironmentColourWriter {
  const targets = readColours().map(({ colour: _colour, ...binding }) => resolveTarget(surfaces, binding));
  let inspections = targets.map(target => inspectionOf(target, null, target.materialNode === null ? skyEnvironmentMaterialAbsentReason : null));
  return {
    write() {
      const colours = readColours();
      if (colours.length !== targets.length || colours.some((entry, index) => entry.setupKey !== targets[index]!.binding.setupKey)) {
        throw new Error("The sky environment bindings changed after the sky materials were bound.");
      }
      inspections = colours.map((entry, index) => {
        const target = targets[index]!;
        if (target.materialNode === null) return inspectionOf(target, null, skyEnvironmentMaterialAbsentReason);
        const writtenRgb = entry.colour.status === "resolved" ? entry.colour.value : null;
        const rgbUnits = writtenRgb === null ? null : [writtenRgb[0] / byteMaximum, writtenRgb[1] / byteMaximum, writtenRgb[2] / byteMaximum] as const;
        for (const { surface, node } of target.surfaces) surface.nativeMaterial.overrideColourSourceRgb(node, rgbUnits);
        return inspectionOf(target, writtenRgb, entry.colour.status === "resolved" ? null : entry.colour.reason);
      });
    },
    inspection: () => inspections,
  };
}
