import { formerlyEditorAuthoredStatusLabel, type ColorRgbTuple, type Vector3Tuple } from "../scene/presentationConfiguration";

export interface NativeSandboxConfiguration {
  playerProfileId: string;
  leatherShirt: boolean;
  origin: Vector3Tuple;
  materialOverrideEnabled: boolean;
  materialEntityId: string;
  materialSource: string;
  materialTint: ColorRgbTuple;
  materialRoughness: number;
  flamePreviewEnabled: boolean;
  flameTextureSeconds: number;
  flameFadeSeconds: number;
  flameTextureRate: number;
  flameFadeRate: number;
  statusLabel: typeof formerlyEditorAuthoredStatusLabel;
  source: { savedScriptValues: string; unsavedCodeDefaults: string };
}

export const nativeSandboxConfiguration: NativeSandboxConfiguration = {
  playerProfileId: "human-male-fighter",
  leatherShirt: true,
  origin: [0, 0, 0],
  materialOverrideEnabled: false,
  materialEntityId: "local-player",
  materialSource: "MFighter.UpBody.MFighter_m001_t04_u",
  materialTint: [0.45, 1, 0.6],
  materialRoughness: 0.45,
  flamePreviewEnabled: true,
  flameTextureSeconds: 0,
  flameFadeSeconds: 0,
  flameTextureRate: 1,
  flameFadeRate: 1,
  statusLabel: formerlyEditorAuthoredStatusLabel,
  source: {
    savedScriptValues: "assets/native-parity.scene/config.json metadata.scripts[0].values",
    unsavedCodeDefaults: "src/scripts/nativeParity.ts field initializers at commit 89205db (playerProfileId and flame replay fields)",
  },
};
