import { createNativeWindowLayer, type NativeWindowLayer } from "../ui/nativeWindows/nativeWindowLayer";
import type { GameWorldAdapter } from "../world/GameWorldAdapter";
import type { WorldEntity } from "../world/worldTypes";

export interface MountedSandboxWindowLayer {
  readonly layer: NativeWindowLayer;
  release(): void;
}

export function mountSandboxWindowLayer(interfaceRoot: HTMLElement, adapter: Pick<GameWorldAdapter, "subscribe">,
  readLocalPlayer: () => WorldEntity | null): MountedSandboxWindowLayer {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.inset = "0";
  interfaceRoot.prepend(host);
  const layer = createNativeWindowLayer(host, readLocalPlayer);
  const unsubscribe = adapter.subscribe(event => { if (event.type === "update" && event.entity.kind === "local-player") layer.refresh(); });
  let released = false;
  return {
    layer,
    release: () => {
      if (released) return;
      released = true;
      unsubscribe();
      layer.dispose();
      host.remove();
    },
  };
}
