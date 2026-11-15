import { describe, expect, it } from "vitest";
import { createEffectScheduler } from "../../src/effects/particles/effectScheduler";
import { mapEmitterOwnerKey, playTileMapEmitters, type MapEmitterPlacement, type MapEmitterPlacementView } from "../../src/effects/particles/render/mapEmitterPlayback";
import { parseEmitterActorRecord, parseEmitterRecord } from "../../src/effects/particles/sim/emitterRecords";
import { createPresentationClock } from "../../src/shared/presentationClock";
import { readSyntheticParticleFixture, STATIONARY_OWNER } from "./support/particleFixtures";

const spriteFixture = readSyntheticParticleFixture("synthetic-sprite");
const loopingActor = parseEmitterActorRecord({ ...spriteFixture.actor, effectiveProperties: { ...spriteFixture.actor.effectiveProperties, AutoDestroy: false, AutoReset: true } });
const emitters = [parseEmitterRecord(spriteFixture.components[0]!)];

function placement(placementId: string): MapEmitterPlacement {
  return { placementId, actor: loopingActor, emitters };
}

function fixture(placementIds: readonly string[]) {
  const clock = createPresentationClock(), sampledOwners: string[] = [];
  const scheduler = createEffectScheduler({ clock, sessionSeed: 9, sampleOwner: ownerKey => { sampledOwners.push(ownerKey); return STATIONARY_OWNER; } });
  const visibleMembers = new Set(placementIds), framedPlacements = new Set(placementIds);
  const views = new Map<string, MapEmitterPlacementView & { visible: boolean; renders: number; disposed: boolean }>();
  const playback = playTileMapEmitters({
    scheduler, placements: placementIds.map(placement),
    isPlacementVisible: placementId => visibleMembers.has(placementId),
    isPlacementInFrustum: placementId => framedPlacements.has(placementId),
    createPlacementView: ({ placementId }) => {
      const view = { visible: true, renders: 0, disposed: false,
        setVisible(visible: boolean) { view.visible = visible; }, render() { view.renders += 1; }, dispose() { view.disposed = true; } };
      views.set(placementId, view);
      return view;
    },
  });
  const frame = () => { clock.advance(1 / 60); scheduler.advanceFrame(); playback.update(); };
  return { scheduler, playback, views, visibleMembers, framedPlacements, sampledOwners, frame };
}

describe("tile map emitter playback", () => {
  it("starts every placement's emitter actor on the scheduler under its own owner key", () => {
    const f = fixture(["emitter-1922", "emitter-1923"]);
    expect(f.scheduler.liveEffects.map(effect => effect.ownerKey)).toEqual([mapEmitterOwnerKey("emitter-1922"), mapEmitterOwnerKey("emitter-1923")]);
    f.frame();
    expect(new Set(f.sampledOwners)).toEqual(new Set([mapEmitterOwnerKey("emitter-1922"), mapEmitterOwnerKey("emitter-1923")]));
    expect(f.views.get("emitter-1922")).toMatchObject({ visible: true, renders: 1 });
  });

  it("hides a placement while its BSP member is not visible and keeps simulating it", () => {
    const f = fixture(["emitter-1922", "emitter-1923"]);
    f.visibleMembers.delete("emitter-1923");
    for (let step = 0; step < 5; step += 1) f.frame();
    expect(f.views.get("emitter-1923")).toMatchObject({ visible: false, renders: 0 });
    expect(f.scheduler.liveEffects.find(effect => effect.ownerKey === mapEmitterOwnerKey("emitter-1923"))!.actor.emitters[0]!.liveSlots().length).toBeGreaterThan(0);
    f.visibleMembers.add("emitter-1923"); f.frame();
    expect(f.views.get("emitter-1923")).toMatchObject({ visible: true, renders: 1 });
  });

  it("hides a visible member outside the frustum", () => {
    const f = fixture(["emitter-1922"]);
    f.framedPlacements.clear(); f.frame();
    expect(f.views.get("emitter-1922")).toMatchObject({ visible: false, renders: 0 });
    expect(f.playback.inspect().placements).toEqual([{ placementId: "emitter-1922", effectSerial: 0, visible: false, destroyed: false }]);
  });

  it("refuses repeated placement ids and removes its effects from the scheduler on dispose", () => {
    expect(() => fixture(["emitter-1922", "emitter-1922"])).toThrow("placement ids repeat");
    const f = fixture(["emitter-1922"]);
    f.playback.dispose(); f.playback.dispose();
    expect(f.scheduler.liveEffects).toEqual([]);
    expect(f.views.get("emitter-1922")!.disposed).toBe(true);
  });
});
