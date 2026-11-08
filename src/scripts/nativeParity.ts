import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { visibleAsBoolean, visibleAsNumber, visibleAsString, visibleAsVector3, type IScript } from "babylonjs-editor-tools";
import { createNativeSliceRuntime } from "../runtime/createNativeSliceRuntime";
import { nativeSandboxConfiguration } from "../runtime/nativeSandboxConfiguration";
import { isSceneStartupRequired, registerSceneStartup, reportSceneStartup } from "../scene/prepareSceneForReveal";
import { showLoadingError } from "../ui/LoadingScreen";

export default class NativeParityScript implements IScript {
  @visibleAsString("Player profile") playerProfileId = nativeSandboxConfiguration.playerProfileId;
  @visibleAsBoolean("Start with Leather Shirt (item 22)") leatherShirt = nativeSandboxConfiguration.leatherShirt;
  @visibleAsVector3("Synthetic actor origin") origin = Vector3.FromArray(nativeSandboxConfiguration.origin);
  @visibleAsString("Fighter idle clip") fighterIdle = nativeSandboxConfiguration.fighterIdle;
  @visibleAsString("Fighter run clip") fighterRun = nativeSandboxConfiguration.fighterRun;
  @visibleAsString("Fighter attack clip") fighterAttack = nativeSandboxConfiguration.fighterAttack;
  @visibleAsString("Fighter death clip") fighterDeath = nativeSandboxConfiguration.fighterDeath;
  @visibleAsBoolean("Enable material override", { group: "Native material" }) materialOverrideEnabled = nativeSandboxConfiguration.materialOverrideEnabled;
  @visibleAsString("Actor ID", { group: "Native material" }) materialEntityId = nativeSandboxConfiguration.materialEntityId;
  @visibleAsString("Source material", { group: "Native material" }) materialSource = nativeSandboxConfiguration.materialSource;
  @visibleAsVector3("Tint RGB multiplier", { group: "Native material", min: 0, max: 1, step: .01,
    description: "Linear RGB multipliers on the original material. Converted textures remain unchanged." })
  materialTint = Vector3.FromArray(nativeSandboxConfiguration.materialTint);
  @visibleAsNumber("Roughness", { group: "Native material", min: 0, max: 1, step: .01 }) materialRoughness = nativeSandboxConfiguration.materialRoughness;
  @visibleAsBoolean("Enable source flame preview", { group: "Flame replay",
    description: "Recovered source formulas; native lighting and clock synchronization remain unverified." })
  flamePreviewEnabled = nativeSandboxConfiguration.flamePreviewEnabled;
  @visibleAsNumber("Texture start seconds", { group: "Flame replay", min: 0, step: .01 }) flameTextureSeconds = nativeSandboxConfiguration.flameTextureSeconds;
  @visibleAsNumber("Fade start seconds", { group: "Flame replay", min: 0, step: .01 }) flameFadeSeconds = nativeSandboxConfiguration.flameFadeSeconds;
  @visibleAsNumber("Texture replay rate", { group: "Flame replay", min: 0, step: .1 }) flameTextureRate = nativeSandboxConfiguration.flameTextureRate;
  @visibleAsNumber("Fade replay rate", { group: "Flame replay", min: 0, step: .1 }) flameFadeRate = nativeSandboxConfiguration.flameFadeRate;
  private lifetime: AbortController | undefined;
  private stop: (() => void) | undefined;
  constructor(private readonly scene: Scene) {}
  onStart(): void {
    this.onStop();
    this.scene.useRightHandedSystem = true;
    const lifetime = new AbortController();
    this.lifetime = lifetime;
    const isWorldRequiredByApp = isSceneStartupRequired(this.scene, "native-world");
    const ready = createNativeSliceRuntime(this.scene, this, lifetime.signal, {
      requireWorld: isWorldRequiredByApp,
      onProgress: progress => reportSceneStartup(this.scene, progress),
    }).then(stop => {
      if (lifetime.signal.aborted || this.lifetime !== lifetime) {
        stop(); throw new Error("Native scene startup was cancelled.");
      }
      this.stop = stop;
    });
    registerSceneStartup(this.scene, "native-world", ready);
    void ready.catch((error: unknown) => {
      const isCurrentStart = !lifetime.signal.aborted && this.lifetime === lifetime;
      const isEditorPlayWithoutApp = !isWorldRequiredByApp;
      if (isCurrentStart && isEditorPlayWithoutApp) { console.error(error); showLoadingError(error); }
    });
  }
  onStop(): void {
    const lifetime = this.lifetime, stop = this.stop;
    this.lifetime = undefined; this.stop = undefined;
    lifetime?.abort(); stop?.();
  }
}
