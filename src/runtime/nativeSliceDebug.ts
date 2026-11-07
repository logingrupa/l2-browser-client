import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { Scene } from "@babylonjs/core/scene";
import type { EntityRegistry } from "../entities/EntityRegistry";
import type { DevSection } from "../ui/devSheet/DevSheet";
import type { VariableInfo } from "../ui/devSheet/types";
import type { NativePlayerProfile } from "../assets/native/loadNativePlayerProfiles";
import { readout } from "./nativeSliceSheet";

export interface NativeSliceDebugOptions {
  scene: Scene;
  camera: ArcRotateCamera;
  registry: () => EntityRegistry;
  playerProfile: NativePlayerProfile;
  playerChoices: ReadonlyMap<string, NativePlayerProfile>;
  events: AbortSignal;
}

const parameters = () => new URLSearchParams(globalThis.location?.search ?? "");
const fixed = (value: number, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : "—";

/** Debug › frame/position readouts and the URL parameters that choose this
 * world, each with a hover-card naming its allowed values and effect. */
export function attachNativeSliceDebugSection(section: DevSection, options: NativeSliceDebugOptions): void {
  const { scene, camera, registry, playerProfile, playerChoices, events } = options;
  const frame = section.group("diagnostics", "Frame & position");
  const position = () => registry().localPlayerPosition;
  readout(frame, "Frame rate", () => `${Math.round(scene.getEngine().getFps())} FPS`, "native-debug-fps",
    "Babylon engine frame rate, averaged by the engine. Same value as the HUD FPS counter.", () => [
      { name: "debug.fps", value: () => fixed(scene.getEngine().getFps(), 1), values: "frames per second", source: "AbstractEngine.getFps()", status: "presentation" },
    ]);
  readout(frame, "Entities", () => String(registry().count), "native-debug-entities",
    "Entities presented by the registry: the local fighter and Greater Musveren unless one was despawned.", () => [
      { name: "debug.entities", value: () => String(registry().count), values: "0–2 in this slice", source: "EntityRegistry.count", status: "presentation" },
    ]);
  readout(frame, "Fighter (m)", () => {
    const current = position();
    return current ? `${fixed(current.x)}, ${fixed(current.y)}, ${fixed(current.z)}` : "unavailable";
  }, "native-debug-position", "Browser metres, right-handed, Y up. Native units are (X, Z, Y) × 100.", () => [
    { name: "debug.position.browser", value: () => { const p = position(); return p ? `${fixed(p.x, 3)}, ${fixed(p.y, 3)}, ${fixed(p.z, 3)}` : "unavailable"; },
      values: "metres (x, y, z)", source: "EntityRegistry.localPlayerPosition", status: "presentation" },
    { name: "debug.position.native", value: () => { const p = position(); return p ? `${fixed(p.x * 100, 0)}, ${fixed(p.z * 100, 0)}, ${fixed(p.y * 100, 0)}` : "unavailable"; },
      values: "native units (X, Y, Z)", source: "section placement conversion: native = (x, z, y) × 100; native debug location match unverified", status: "unverified" },
  ]);
  readout(frame, "Camera", () => `r ${fixed(camera.radius, 1)} · α ${fixed(camera.alpha)} · β ${fixed(camera.beta)}`, "native-debug-camera",
    "Orbit camera around the fighter (or the framed world/effect). Drag to orbit, pinch or scroll to zoom.", () => [
      { name: "camera.radius", value: () => fixed(camera.radius, 2), values: `${fixed(camera.lowerRadiusLimit ?? 0, 1)}–${fixed(camera.upperRadiusLimit ?? Infinity, 1)} m`, source: "World camera (ArcRotateCamera)", status: "presentation" },
      { name: "camera.target", value: () => camera.target.asArray().map(value => fixed(value)).join(", "), values: "metres", source: "Follow fighter / Frame world", status: "presentation" },
    ]);

  const url = section.group("url", "URL parameters", {
    hint: "These query parameters choose what loads. Changing one reloads the page; current values are read live from the address bar.",
  });
  const variable = (name: string, values: string, source: string): VariableInfo =>
    ({ name: `url.${name}`, value: () => parameters().get(name) ?? "(not set)", values, source, status: "presentation" });
  readout(url, "world", () => parameters().get("world") ?? "(not set)", "native-debug-url-world",
    "world=interlude opens this 20_20 native slice. world=courtyard opens the synthetic courtyard; leaving it out opens the imported Talking Island preview.",
    () => [variable("world", "interlude | courtyard | (not set)", "src/scene/loadEnvironment.ts")]);
  readout(url, "authored", () => parameters().get("authored") ?? "(not set)", "native-debug-url-authored",
    "authored=1 loads the Babylon Editor saved world (public/scene/native-world.babylon) instead of importing the staged source section into native-parity.babylon.",
    () => [variable("authored", "1 | (not set)", "src/scene/loadEnvironment.ts (with world=interlude)")]);
  readout(url, "character", () => parameters().get("character") ?? `(not set → ${playerProfile.id})`, "native-debug-url-character",
    "Player profile id from catalog.playerProfiles. Use Character › Play as… to switch.", () => [
      variable("character", [...playerChoices.keys()].join(" | "), "catalog.playerProfiles (src/runtime/createNativeSliceRuntime.ts)"),
      { name: "character.active", value: () => `${playerProfile.id} · ${playerProfile.name}`, values: [...playerChoices.values()].map(choice => choice.name).join(" | "),
        source: "loadNativeActorCatalog playerProfile", status: "native" },
    ]);
  const open = (label: string, testId: string, authored: boolean, hint: string) => {
    const current = parameters().get("world") === "interlude" && (parameters().get("authored") === "1") === authored;
    const button = url.button({ label, testId, hint, disabled: current });
    button.addEventListener("click", () => {
      const next = new URL(globalThis.location.href);
      next.searchParams.set("world", "interlude");
      if (authored) next.searchParams.set("authored", "1"); else next.searchParams.delete("authored");
      globalThis.location.assign(next.href);
    }, { signal: events });
  };
  open("Open source world", "native-debug-open-source", false, "Reload with world=interlude: the staged source section is imported at startup.");
  open("Open authored world", "native-debug-open-authored", true, "Reload with world=interlude&authored=1: the Babylon Editor saved native world.");
}
