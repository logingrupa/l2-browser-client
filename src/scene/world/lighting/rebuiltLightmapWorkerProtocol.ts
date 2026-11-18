import { buildLightingTables, type LightingTables } from "../../../environment/model/lightmapRebuild/lightingTables";
import type { RebuiltLightmapResult } from "./composeRebuiltLightmap";
import { composeRebuiltLightmapRequest, type RebuiltLightmapRequest } from "./rebuiltLightmapRequest";
import { TileLightingDecodeError } from "./tileLightingDecodeError";

export interface RebuiltLightmapWorkerRequest {
  readonly id: number;
  readonly request: RebuiltLightmapRequest;
}

export type RebuiltLightmapWorkerReply =
  | { readonly id: number; readonly result: RebuiltLightmapResult }
  | { readonly id: number; readonly failure: string };

export interface RebuiltLightmapWorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<RebuiltLightmapWorkerRequest>) => void): void;
  postMessage(message: RebuiltLightmapWorkerReply, options: StructuredSerializeOptions): void;
}

export interface RebuiltLightmapWorker {
  addEventListener(type: "message", listener: (event: MessageEvent<RebuiltLightmapWorkerReply>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  postMessage(message: RebuiltLightmapWorkerRequest): void;
  terminate(): void;
}

interface RebuiltLightmapComposer {
  compose(request: RebuiltLightmapRequest): Promise<RebuiltLightmapResult>;
  dispose(): void;
}

interface PendingComposition {
  readonly resolve: (result: RebuiltLightmapResult) => void;
  readonly reject: (error: Error) => void;
}

export function serveRebuiltLightmapRequests(scope: RebuiltLightmapWorkerScope): void {
  let tables: LightingTables | null = null;
  scope.addEventListener("message", ({ data: { id, request } }) => {
    try {
      tables ??= buildLightingTables();
      const result = composeRebuiltLightmapRequest(request, tables);
      scope.postMessage({ id, result }, { transfer: result.status === "resolved" ? [result.value.rgba.buffer] : [] });
    } catch (error) {
      scope.postMessage({ id, failure: error instanceof Error ? error.message : String(error) }, { transfer: [] });
    }
  });
}

function rejectPendingCompositions(pending: Map<number, PendingComposition>, error: Error): void {
  for (const composition of pending.values()) composition.reject(error);
  pending.clear();
}

function listenToWorker(worker: RebuiltLightmapWorker, pending: Map<number, PendingComposition>, discardFailedWorker: () => void): void {
  worker.addEventListener("message", ({ data: reply }) => {
    const composition = pending.get(reply.id);
    if (composition === undefined) return;
    pending.delete(reply.id);
    if ("failure" in reply) composition.reject(new TileLightingDecodeError(`rebuilt lightmap composition failed: ${reply.failure}`));
    else composition.resolve(reply.result);
  });
  worker.addEventListener("error", event => {
    discardFailedWorker();
    rejectPendingCompositions(pending, new TileLightingDecodeError(`rebuilt lightmap worker failed: ${event.message}`));
  });
}

export function createRebuiltLightmapWorkerComposer(startWorker: () => RebuiltLightmapWorker): RebuiltLightmapComposer {
  const pending = new Map<number, PendingComposition>();
  let worker: RebuiltLightmapWorker | null = null, nextRequestId = 0;
  const runningWorker = (): RebuiltLightmapWorker => {
    if (worker !== null) return worker;
    const started = startWorker();
    worker = started;
    listenToWorker(started, pending, () => {
      started.terminate();
      if (worker === started) worker = null;
    });
    return started;
  };
  return {
    compose(request) {
      const id = nextRequestId++, running = runningWorker();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        running.postMessage({ id, request });
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      rejectPendingCompositions(pending, new TileLightingDecodeError("rebuilt lightmap worker disposed before the composition finished"));
    },
  };
}
