import { describe, expect, it, vi } from "vitest";
import { buildLightingTables } from "../../src/environment/model/lightmapRebuild/lightingTables";
import type { LightmapRebuildRecord } from "../../src/scene/world/lighting/decodeLightmapRebuildInputs";
import { composeRebuiltLightmapRequest, type RebuiltLightmapRequest } from "../../src/scene/world/lighting/rebuiltLightmapRequest";
import {
  createRebuiltLightmapWorkerComposer, serveRebuiltLightmapRequests, type RebuiltLightmapWorker, type RebuiltLightmapWorkerReply, type RebuiltLightmapWorkerRequest,
  type RebuiltLightmapWorkerScope,
} from "../../src/scene/world/lighting/rebuiltLightmapWorkerProtocol";
import { authoredFields, pointLightFields, rebuildEnvironmentAtHourSix, rebuildLightActor, rebuildZone } from "../support/lightmapRebuildFixture";

const record: LightmapRebuildRecord = { zone: 2, atlasX: 0, atlasY: 0, surface: { normal: [0, 0, -1], polyFlags: 0 },
  projection: { width: 4, height: 2, origin: [0, 0, 0], uStep: [1, 0, 0], vStep: [0, 1, 0] },
  shadows: [{ light: 0, height: 1, rowBytes: 1, minimumX: 0, minimumY: 0, maximumX: 3, maximumY: 0, bits: Uint8Array.of(0x0f) }] };

function rebuildRequest(lightFields: Readonly<Record<string, unknown>> = pointLightFields): RebuiltLightmapRequest {
  return { edge: 8, records: [record], lights: [rebuildLightActor("Engine.Light", lightFields)], levelInfos: [{ exportIndex: 2, fields: authoredFields({ Brightness: 1 }) }],
    zones: [rebuildZone(2, { AmbientHue: 0, AmbientSaturation: 255, AmbientBrightness: 40 })], environment: rebuildEnvironmentAtHourSix };
}

function messageEvent<Data>(data: Data): MessageEvent<Data> {
  return { data } as MessageEvent<Data>;
}

function inMemoryWorker() {
  const workerListeners: ((event: MessageEvent<RebuiltLightmapWorkerRequest>) => void)[] = [];
  const replyListeners: ((event: MessageEvent<RebuiltLightmapWorkerReply>) => void)[] = [];
  const errorListeners: ((event: ErrorEvent) => void)[] = [];
  const scope: RebuiltLightmapWorkerScope = {
    addEventListener: (_type, listener) => { workerListeners.push(listener); },
    postMessage: (reply, options) => queueMicrotask(() => replyListeners.forEach(listener => listener(messageEvent(structuredClone(reply, options))))),
  };
  serveRebuiltLightmapRequests(scope);
  const terminate = vi.fn();
  const worker = {
    addEventListener: (type: string, listener: (event: MessageEvent<RebuiltLightmapWorkerReply> | ErrorEvent) => void) => {
      if (type === "message") replyListeners.push(listener);
      else errorListeners.push(listener);
    },
    postMessage: (request: RebuiltLightmapWorkerRequest) => queueMicrotask(() => workerListeners.forEach(listener => listener(messageEvent(structuredClone(request))))),
    terminate,
  } as unknown as RebuiltLightmapWorker;
  const fail = (message: string) => errorListeners.forEach(listener => listener({ message } as ErrorEvent));
  return { worker, terminate, fail };
}

describe("rebuilt lightmap worker protocol", () => {
  it("composes off the calling thread with the same pixels as an in-thread composition and starts the worker only at first need", async () => {
    const { worker } = inMemoryWorker(), startWorker = vi.fn(() => worker);
    const composer = createRebuiltLightmapWorkerComposer(startWorker);
    expect(startWorker).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([composer.compose(rebuildRequest()), composer.compose(rebuildRequest())]);
    expect(startWorker).toHaveBeenCalledTimes(1);
    expect(first).toEqual(composeRebuiltLightmapRequest(rebuildRequest(), buildLightingTables()));
    expect(second).toEqual(first);
  });

  it("rejects with the decode error a malformed light field raises inside the worker", async () => {
    const { worker } = inMemoryWorker();
    const composer = createRebuiltLightmapWorkerComposer(() => worker);
    await expect(composer.compose(rebuildRequest({ ...pointLightFields, LightEffect: "spot" }))).rejects.toThrow(/rebuilt lightmap composition failed: .*LightEffect = "spot" is not a byte/);
  });

  it("rejects the running compositions when the worker fails and starts a fresh worker for the next composition", async () => {
    const failing = inMemoryWorker(), fresh = inMemoryWorker();
    const startWorker = vi.fn().mockReturnValueOnce(failing.worker).mockReturnValueOnce(fresh.worker);
    const composer = createRebuiltLightmapWorkerComposer(startWorker);
    const running = composer.compose(rebuildRequest());
    failing.fail("module script failed");
    await expect(running).rejects.toThrow(/rebuilt lightmap worker failed: module script failed/);
    expect(failing.terminate).toHaveBeenCalledTimes(1);
    expect(await composer.compose(rebuildRequest())).toEqual(composeRebuiltLightmapRequest(rebuildRequest(), buildLightingTables()));
    expect(startWorker).toHaveBeenCalledTimes(2);
  });

  it("terminates the worker and rejects a composition still running on dispose", async () => {
    const { worker, terminate } = inMemoryWorker();
    const composer = createRebuiltLightmapWorkerComposer(() => worker);
    const running = composer.compose(rebuildRequest());
    composer.dispose();
    expect(terminate).toHaveBeenCalledTimes(1);
    await expect(running).rejects.toThrow(/disposed before the composition finished/);
  });
});
