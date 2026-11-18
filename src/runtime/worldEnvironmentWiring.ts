import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import { sourceDistanceToWorld } from "../world/sourceFrame";
import { inspectWorldTimeOfDay, type WorldTimeOfDay, type WorldTimeOfDayInspection } from "../scene/world/worldTimeOfDay";
import type { WorldEvent } from "../world/worldTypes";
import type { NativeEnvironmentManager } from "../environment/model/nativeEnvironmentManager";
import type { CameraEnvironmentFog } from "../scene/world/cameraEnvironment";

export type CameraFarPlaneSource = "fog-end" | "presentation" | "sky-fog-unresolved";

export interface CameraFarPlane {
  readonly maxZ: number;
  readonly source: CameraFarPlaneSource;
}

export interface WorldEnvironmentOptions {
  readonly adapter: Pick<GameWorldAdapter, "subscribe">;
  readonly camera: { maxZ: number };
  readonly timeOfDay: WorldTimeOfDay;
  readonly cameraFog: () => CameraEnvironmentFog | null;
  readonly presentationFarPlane: number;
}

export interface WorldEnvironmentInspection {
  readonly timeOfDay: WorldTimeOfDayInspection;
  readonly serverPacket: typeof serverPacketGap;
  readonly farPlane: CameraFarPlane;
  readonly appliedEventCount: number;
  readonly ignoredEventCount: number;
  readonly lastIgnoredEvent: string | null;
  readonly rejectedEventCount: number;
  readonly lastRejectedEvent: string | null;
}

export interface WorldEnvironment {
  update(): void;
  inspection(): WorldEnvironmentInspection;
  release(): void;
}

const serverPacketGap = { producer: "sandbox-command", status: "unresolved", reason: "server-packet-unresolved" } as const;
export function cameraFarPlane(cameraFog: CameraEnvironmentFog | null, presentationFarPlane: number): CameraFarPlane {
  const levelFog = cameraFog?.fog ?? null;
  if (levelFog === null || !levelFog.enabled || levelFog.fogEnd === null) return { maxZ: presentationFarPlane, source: "presentation" };
  if (cameraFog!.skyFog.route === null) return { maxZ: presentationFarPlane, source: "sky-fog-unresolved" };
  return { maxZ: sourceDistanceToWorld(levelFog.fogEnd), source: "fog-end" };
}

type EnvironmentWorldEvent = Extract<WorldEvent, { readonly type: "server-time" | "environment-ssq-info" | "environment-red-sky" }>;

type EnvironmentEventDelivery =
  | { readonly outcome: "applied" }
  | { readonly outcome: "ignored" | "rejected"; readonly reason: string };

function receiveEnvironmentEvent(manager: NativeEnvironmentManager, event: EnvironmentWorldEvent): EnvironmentEventDelivery {
  if (event.type === "server-time") {
    manager.receiveServerTime(event.gameMinutes);
    return { outcome: "applied" };
  }
  const change = event.type === "environment-ssq-info" ? manager.receiveSsqInfo(event.first, event.second) : manager.receiveRedSky(event.timeoutSeconds);
  return change === "changed" ? { outcome: "applied" } : { outcome: "ignored", reason: `${event.type}: ChangeEnv ${change}` };
}

function deliverEnvironmentEvent(timeOfDay: WorldTimeOfDay, event: WorldEvent): EnvironmentEventDelivery | null {
  if (event.type !== "server-time" && event.type !== "environment-ssq-info" && event.type !== "environment-red-sky") return null;
  if (timeOfDay.status === "gap") return { outcome: "rejected", reason: timeOfDay.reason };
  try {
    return receiveEnvironmentEvent(timeOfDay.manager, event);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { outcome: "rejected", reason: error.message };
  }
}

export function wireWorldEnvironment(options: WorldEnvironmentOptions): WorldEnvironment {
  const { adapter, camera, timeOfDay, presentationFarPlane } = options;
  if (!Number.isFinite(presentationFarPlane) || presentationFarPlane <= 0) throw new RangeError("The presentation far plane must be a positive finite distance.");
  let appliedEventCount = 0, ignoredEventCount = 0, rejectedEventCount = 0;
  let lastIgnoredEvent: string | null = null, lastRejectedEvent: string | null = null;
  let farPlane: CameraFarPlane = { maxZ: presentationFarPlane, source: "presentation" };
  const unsubscribe = adapter.subscribe(event => {
    const delivery = deliverEnvironmentEvent(timeOfDay, event);
    if (delivery === null) return;
    if (delivery.outcome === "applied") appliedEventCount += 1;
    else if (delivery.outcome === "ignored") { ignoredEventCount += 1; lastIgnoredEvent = delivery.reason; }
    else { rejectedEventCount += 1; lastRejectedEvent = delivery.reason; }
  });
  return {
    update() {
      farPlane = cameraFarPlane(options.cameraFog(), presentationFarPlane);
      camera.maxZ = farPlane.maxZ;
    },
    inspection: () => ({ timeOfDay: inspectWorldTimeOfDay(timeOfDay), serverPacket: serverPacketGap, farPlane, appliedEventCount, ignoredEventCount, lastIgnoredEvent,
      rejectedEventCount, lastRejectedEvent }),
    release: unsubscribe,
  };
}
