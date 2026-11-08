import { nativeAliasCoverage, nativeAliasCoverageText } from "../assets/native/nativeAnimationAliases";
import { attachNativeAnimationAliasTable } from "../ui/nativeAnimationAliasTable";
import type { DevSection } from "../ui/devSheet/DevSheet";
import type { VariableInfo } from "../ui/devSheet/types";
import { PRESENTATION_CHOICE, type NativeSliceSheetTools } from "./nativeSliceSheet";
import { nativeSandboxSettingVariables } from "./presentationConfigurationVariables";
import type { NativeSliceSheetContext } from "./attachNativeSliceSheet";

function attachEquipmentGroup(section: DevSection, context: NativeSliceSheetContext, tools: NativeSliceSheetTools): void {
  const { adapter, registry, playerProfile, playerChoices, profileStagesLeatherShirt } = context;
  const appearanceGroup = section.group("appearance", "Character & equipment");
  const equipmentVariables = (): VariableInfo[] => [
    { name: "equipment.upper", value: () => { const upper = registry.localPlayer?.equipment?.upper; return upper === undefined ? "starter shirt (none)" : `item ${upper}`; },
      values: "22 (Leather Shirt) | none", source: "armorgrp item 22 package; equip-item command, slot upper", status: "native" },
    { name: "character.profile", value: () => `${playerProfile.id} · ${playerProfile.name}`, values: [...playerChoices.values()].map(choice => choice.name).join(" | "), source: "catalog.playerProfiles (?character=)", status: "native" },
  ];
  if (playerChoices.size > 1) {
    appearanceGroup.choice({ label: "Play as", testId: "native-play-as", display: "chips", value: playerProfile.id,
      options: [...playerChoices.values()].map(choice => ({ value: choice.id, label: choice.name.replace(/^Human (\w)/, (_, first: string) => first.toUpperCase()),
        hint: `Reloads with ?character=${choice.id}. Native scale: collision ${choice.collisionRadius}/${choice.collisionHeight} source units, DrawScale ${choice.actorScale.join("/")}.` })),
      hint: "Each choice reloads the slice with ?character=<id> and its own staged native package and clips (no height fitting).",
      variables: equipmentVariables,
      onChange: id => { const url = new URL(window.location.href); url.searchParams.set("character", id); window.location.assign(url.href); } });
  }
  tools.button(appearanceGroup, "Leather shirt", () => adapter.dispatch({ type: "equip-item", slot: "upper", itemId: 22 }),
    { hint: profileStagesLeatherShirt ? "Equips armorgrp item 22. Musveren's hits then use its own defense sounds." : `No item 22 upper part is staged for ${playerProfile.name}.`,
      variables: equipmentVariables, disabled: !profileStagesLeatherShirt });
  tools.button(appearanceGroup, "Starter shirt", () => adapter.dispatch({ type: "equip-item", slot: "upper", itemId: null }),
    { hint: "Removes the upper armor and restores the starter body part.", variables: equipmentVariables, disabled: !profileStagesLeatherShirt });
}

function attachAnimationAliasGroup(section: DevSection, context: NativeSliceSheetContext, tools: NativeSliceSheetTools): void {
  const { registry, playerProfile, clipPreview, ui } = context;
  const aliasEvidence = playerProfile.aliasEvidence;
  const aliasCoverage = nativeAliasCoverage(playerProfile.clips, aliasEvidence);
  const archiveSha256 = context.archiveHashes?.get(playerProfile.catalogId) ?? null;
  const aliasGroup = section.group("aliases", "Animation aliases", {
    hint: "Every native animation alias of this model: the Engine.Pawn localized key (WT_HAND family, index 0; socials PcSocialAnimName[N]) and the exact package clip it names. Tap a clip to play it once on your character. 'damage' stays empty: no class section assigns DamageAnimName and Interlude has no hit-reaction clip; Damagefly_<Class> (DamageFlyAnimName) is a knock-back.",
    variables: () => [
      { name: "aliases.coverage", value: () => nativeAliasCoverageText(aliasCoverage), values: `0-${aliasCoverage.total} of the browser's alias list`,
        source: aliasEvidence ? `${aliasEvidence.report} · sha ${aliasEvidence.reportSha256.slice(0, 12)}…` : "no staged alias evidence for this profile", status: aliasEvidence ? "native" : "unverified" },
      { name: "aliases.family", value: () => aliasEvidence?.family ?? "-", values: "WT_HAND (unarmed)",
        source: aliasEvidence ? `${aliasEvidence.familySource} · sha ${aliasEvidence.familySourceSha256.slice(0, 12)}…` : "-", status: aliasEvidence ? "native" : "unverified" },
      { name: "aliases.package", value: () => playerProfile.catalogId, values: "catalog.models id",
        source: `${playerProfile.assetId} · archive ${archiveSha256 ? `${archiveSha256.slice(0, 12)}…` : "unknown"}`, status: "native" },
      { name: "aliases.preview", value: () => clipPreview.previewing("local-player") ?? "-", values: "clip name while a preview plays",
        source: `one pass on the local actor, then the requested state (${PRESENTATION_CHOICE})`, status: "presentation" },
    ] });
  aliasGroup.readout({ label: "Coverage", testId: "native-alias-coverage", value: () => `${nativeAliasCoverageText(aliasCoverage)} · ${playerProfile.name}`,
    hint: "Aliases with an exact package clip, out of every alias the browser knows. Missing aliases are listed with their reason, never invented." });
  aliasGroup.readout({ label: "Clip now", testId: "native-alias-clip-now", value: () => {
    const previewing = clipPreview.previewing("local-player");
    return previewing ? `${previewing} (preview)` : registry.sourceClock("local-player")?.clip ?? "-";
  }, hint: "The clip the local actor's source clock is playing.", variables: () => tools.actorVariables("local-player", "fighter") });
  const aliasTable = attachNativeAnimationAliasTable(aliasGroup.element, { coverage: aliasCoverage, profileName: playerProfile.name,
    packageLabel: `${playerProfile.catalogId} · ${playerProfile.assetId}`, archiveSha256, family: aliasEvidence?.family ?? null,
    play: clip => clipPreview.play("local-player", clip), previewing: () => clipPreview.previewing("local-player"),
    describe: (element, info, options) => ui.sheet.describe(element, info, options), onStatus: message => ui.showStatus(message), signal: tools.events });
  context.addRelease(() => aliasTable.dispose());
}

function attachSandboxSettingsGroup(section: DevSection, context: NativeSliceSheetContext): void {
  const variables = nativeSandboxSettingVariables(context.settings);
  const settingsGroup = section.group("sandbox-settings", "Sandbox settings", {
    hint: "The player, clip, shirt, material and flame replay settings this runtime started with. They are browser presentation values carried over from the Editor scene script, not Lineage II data.",
    variables: () => variables,
  });
  settingsGroup.readout({ label: "Settings", testId: "native-sandbox-settings", value: () => `${variables.length} values · presentation, not L2`,
    hint: "Hover for every sandbox setting with its tracked source.", variables: () => variables });
}

export function attachNativeSliceCharacterSheet(section: DevSection, context: NativeSliceSheetContext, tools: NativeSliceSheetTools): void {
  attachEquipmentGroup(section, context, tools);
  attachAnimationAliasGroup(section, context, tools);
  attachSandboxSettingsGroup(section, context);
}
