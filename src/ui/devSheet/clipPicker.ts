import { startPickerLifetime } from "./sandboxPickerControls";
import type { SandboxPickerFactory } from "./sandboxPickerRegistry";

export function createClipPicker(): SandboxPickerFactory {
  return {
    id: "clips",
    title: "Clips",
    attach(group, context) {
      const lifetime = startPickerLifetime(group);
      const listeners = new AbortController();
      let clipNodes: Element[] = [];
      const renderClips = () => {
        for (const node of clipNodes) node.remove();
        const nodesBeforeRender = new Set<Element>(Array.from(group.element.children));
        const entityId = actorChoice.value;
        const listing = entityId ? context.host.actorClipListing(entityId) : null;
        listing?.clips.forEach((clip, position) => {
          group.button({
            label: clip.name, testId: `sandbox-clips-clip-${position}`,
            onClick: () => { if (lifetime.active()) context.host.dispatch({ type: "play-clip", entityId, clipName: clip.name }); },
          });
        });
        clipNodes = Array.from(group.element.children).filter(node => !nodesBeforeRender.has(node));
      };
      const actorChoice = group.choice({ label: "Actor", testId: "sandbox-clips-actor", display: "select", options: [], onChange: renderClips });
      const rereadActors = () => {
        if (!lifetime.active()) return;
        const entityIds = context.host.actorClipEntityIds();
        const chosenEntityId = entityIds.includes(actorChoice.value) ? actorChoice.value : entityIds[0] ?? "";
        actorChoice.setOptions(entityIds.map(entityId => ({ value: entityId, label: entityId })));
        actorChoice.set(chosenEntityId);
        actorChoice.element.hidden = entityIds.length === 0;
        renderClips();
      };
      group.header.addEventListener("click", () => { if (!group.collapsed) rereadActors(); }, { signal: listeners.signal });
      rereadActors();
      return () => { listeners.abort(); lifetime.release(); };
    },
  };
}
