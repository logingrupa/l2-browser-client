import type { ActorClip, ActorClipListing } from "../../animation/actorClipPlayback";
import type { ActorClipEvent } from "../../assets/native/actorClipEvents";
import { startPickerLifetime } from "./sandboxPickerControls";
import type { SandboxPickerFactory } from "./sandboxPickerRegistry";
import type { VariableInfo } from "./types";

const clipListingSource = "clip hub listing of the chosen actor's converted package";
const noLoadedActorText = "No loaded actor has clips.";

function describeClipEvent(event: ActorClipEvent): string {
  return `${event.normalizedTime} ${event.type} ${event.sound ?? "no sound"}`;
}

function clipVariables(clip: ActorClip, listing: ActorClipListing, previewing: () => string | null): VariableInfo[] {
  return [
    { name: "clip.name", value: () => clip.name, values: "the clip name exactly as the package holds it", source: clipListingSource, status: "native" },
    { name: "clip.durationSeconds", value: () => String(clip.durationSeconds), values: "seconds, from the package's native timing",
      source: clipListingSource, status: "native" },
    { name: "clip.events", value: () => clip.events.length === 0 ? "none" : clip.events.map(describeClipEvent).join("; "),
      values: "<normalized time> <type> <sound | no sound>; ... | none", source: `${clipListingSource}, notification events of this clip`, status: "native" },
    { name: "clips.eventsWithoutClip", value: () => String(listing.eventsWithoutClip.length),
      values: "count of notification events naming a clip the package does not hold", source: clipListingSource, status: "native" },
    { name: "clips.previewing", value: () => previewing() ?? "none", values: "clip name | none",
      source: "the chosen actor's clip player after play-clip", status: "presentation" },
  ];
}

export function createClipPicker(): SandboxPickerFactory {
  return {
    id: "clips",
    title: "Clips",
    attach(group, context) {
      const lifetime = startPickerLifetime(group);
      const listeners = new AbortController();
      let renderedNodes: Element[] = [];
      group.button({
        label: "Reread clip listings", testId: "sandbox-clips-reread",
        hint: "Rereads the loaded actors and their clips from the clip hub. Opening this group rereads them too.",
        onClick: () => rereadActors(),
      });
      const renderClips = () => {
        for (const node of renderedNodes) node.remove();
        const nodesBeforeRender = new Set<Element>(Array.from(group.element.children));
        const entityId = actorChoice.value;
        const listing = entityId ? context.host.actorClipListing(entityId) : null;
        if (!entityId) group.note(noLoadedActorText, { tone: "warning", testId: "sandbox-clips-note" });
        else if (!listing || listing.clips.length === 0) group.note(`${entityId} has no clips.`, { tone: "warning", testId: "sandbox-clips-note" });
        else {
          const previewing = () => context.host.previewing(entityId);
          listing.clips.forEach((clip, position) => {
            group.button({
              label: clip.name, testId: `sandbox-clips-clip-${position}`, variables: () => clipVariables(clip, listing, previewing),
              hint: `Dispatches play-clip for ${entityId} with this clip name.`,
              onClick: () => { if (lifetime.active()) context.host.dispatch({ type: "play-clip", entityId, clipName: clip.name }); },
            });
          });
        }
        renderedNodes = Array.from(group.element.children).filter(node => !nodesBeforeRender.has(node));
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
