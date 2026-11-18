import { serveRebuiltLightmapRequests, type RebuiltLightmapWorkerScope } from "./rebuiltLightmapWorkerProtocol";

serveRebuiltLightmapRequests(self as unknown as RebuiltLightmapWorkerScope);
