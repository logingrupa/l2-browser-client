import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import { sourceDistanceToWorld } from "../world/sourceFrame";
import type { FogState } from "../materials/ue2/babylon/material";
import { inspectWorldTimeOfDay, type WorldTimeOfDay, type WorldTimeOfDayInspection } from "../scene/world/worldTimeOfDay";
import type { WorldEvent } from "../world/worldTypes";
import type { NativeEnvironmentManager } from "../environment/model/nativeEnvironmentManager";
import type { NativeSection } from "../scene/world/loadNativeSection";

export type CameraFarPlaneSource = "fog-end" | "presentation";

export interface CameraFarPlane {
  readonly maxZ: number;
  readonly source: CameraFarPlaneSource;
}

export interface WorldEnvironmentOptions {
  readonly adapter: Pick<GameWorldAdapter, "subscribe">;
  readonly camera: { maxZ: number };
  readonly timeOfDay: WorldTimeOfDay;
  readonly cameraFog: () => FogState | null;
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
const noCameraZone = -1;

export function cameraFogOnZoneChange(section: Pick<NativeSection, "tileVisibility" | "inspection">): () => FogState | null {
  let readCameraZone: number | null = null, fog: FogState | null = null;
  return () => {
    const cameraZone = section.tileVisibility?.frame()?.cameraZone ?? noCameraZone;
    if (cameraZone === readCameraZone) return fog;
    readCameraZone = cameraZone;
    const lighting = section.inspection().lighting;
    fog = lighting !== undefined && "cameraEnvironment" in lighting ? lighting.cameraEnvironment.fog : null;
    return fog;
  };
}

export function cameraFarPlane(fog: FogState | null, presentationFarPlane: number): CameraFarPlane {
  if (fog !== null && fog.enabled && fog.fogEnd !== null) return { maxZ: sourceDistanceToWorld(fog.fogEnd), source: "fog-end" };
  return { maxZ: presentationFarPlane, source: "presentation" };
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
