import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nativeAliasCoverage } from "../../src/assets/native/nativeAnimationAliases";
import type { NativePlayerProfile } from "../../src/assets/native/loadNativePlayerProfiles";
import { attachNativeAnimationAliasTable } from "../../src/ui/nativeAnimationAliasTable";
import type { DevInfo } from "../../src/ui/devSheet/types";
import { devSheetStyles } from "../../src/ui/devSheet/devSheetStyles";
import { fire, installMiniDom, type FakeElement, type MiniDom } from "./support/miniDom";

const recipe = JSON.parse(readFileSync(resolve("recipes/native-player-aliases-stage.json"), "utf8")) as { profiles: NativePlayerProfile[] };
const mystic = recipe.profiles.find(row => row.id === "human-female-mystic")!;

describe("developer sheet animation alias table", () => {
  let dom: MiniDom;
  beforeEach(() => { dom = installMiniDom(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); dom.restore(); });

  function attach(play = vi.fn<(clip: string) => string | null>(() => null)) {
    const host = dom.document.createElement("div"), cards: { element: Element; info: DevInfo }[] = [];
    let previewing: string | null = null;
    const controller = new AbortController(), onStatus = vi.fn<(message: string) => void>();
    const table = attachNativeAnimationAliasTable(host as unknown as HTMLElement, {
      coverage: nativeAliasCoverage(mystic.clips, mystic.aliasEvidence), profileName: mystic.name,
      packageLabel: `${mystic.catalogId} · ${mystic.assetId}`, archiveSha256: "329a868a67a9d30c173b5d6f52458cfaa36ed1960ee5606ea5273bfae6f36622",
      family: "WT_HAND", play, previewing: () => previewing, onStatus, signal: controller.signal,
      describe: (element, info) => { cards.push({ element, info }); return () => undefined; } });
    return { host: host as unknown as FakeElement, table, cards, play, onStatus, controller, setPreviewing: (clip: string | null) => { previewing = clip; } };
  }

  it("lists every alias with its clip, one tap-to-play button per bound clip, and damage with its reason", () => {
    const { host, cards } = attach();
    const rows = host.querySelectorAll('[role="row"]');
    expect(rows).toHaveLength(46);
    expect(host.querySelectorAll("button.native-alias-play")).toHaveLength(45);
    const damage = host.querySelector('[data-alias="damage"]')!;
    expect(damage.hasAttribute("data-unbound")).toBe(true); expect(damage.querySelector("button.native-alias-play")).toBeNull();
    expect(damage.textContent).toContain("no native clip · Interlude has no hit-reaction clip; DamageFly = knock-back (Damagefly_FMagic)");
    expect(host.querySelector('[data-alias="castMid"] button.native-alias-play')?.getAttribute("data-clip")).toBe("castMid_FMagic");
    expect(host.querySelector(".native-alias-list")?.hasAttribute("data-dev-rows")).toBe(true);
    const ownGridSkippedByGenericHostedModuleRule = "own";
    expect(host.querySelector(".native-alias-table")?.getAttribute("data-dev-layout")).toBe(ownGridSkippedByGenericHostedModuleRule);
    expect(rows.every(row => row.getAttribute("data-dev-layout") === ownGridSkippedByGenericHostedModuleRule)).toBe(true);
    expect(cards).toHaveLength(46);
    const idle = cards.find(card => card.info.title === "idle · WaitAnimName[0]")!;
    const variables = idle.info.variables!();
    expect(variables.find(row => row.name === "alias.key")?.value()).toBe("WaitAnimName[0]");
    expect(variables.find(row => row.name === "alias.clip")).toMatchObject({ status: "native", source: expect.stringContaining("human-female-mystic:0") });
    expect(variables.find(row => row.name === "alias.preview")?.status).toBe("presentation");
    expect(cards.find(card => card.info.title === "damage · DamageAnimName[0]")!.info.description).toContain("do not substitute DamageFly");
  });

  it("is excluded from every generic hosted-module grid rule of the sheet", () => {
    const generic = devSheetStyles.match(/div\[data-testid\]:not\([^)]*\)/g) ?? [];
    expect(generic.length).toBeGreaterThan(0);
    for (const selector of generic) expect(selector).toContain('[data-dev-layout="own"]');
  });

  it("plays the tapped clip, reports a refusal and marks the clip being previewed", () => {
    const play = vi.fn<(clip: string) => string | null>(clip => clip === "Swim_FMagic" ? "Revive the character to preview its clips." : null);
    const { host, onStatus, setPreviewing, controller } = attach(play);
    const walk = host.querySelector('[data-alias="walk"] button.native-alias-play')!;
    setPreviewing("Walk_Hand_FMagic"); fire(walk, "click");
    expect(play).toHaveBeenCalledWith("Walk_Hand_FMagic"); expect(walk.getAttribute("aria-pressed")).toBe("true");
    fire(host.querySelector('[data-alias="swim"] button.native-alias-play')!, "click");
    expect(onStatus).toHaveBeenCalledWith("Revive the character to preview its clips.");
    setPreviewing(null); vi.advanceTimersByTime(300);
    expect(walk.getAttribute("aria-pressed")).toBe("false");
    controller.abort();
    expect(host.querySelector(".native-alias-table")).toBeNull();
  });
});
