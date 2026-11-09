import { loadNativeCombatAudio, type NativeCombatAudioBundle } from "../../../src/audio/loadNativeCombatAudio";

export interface ActorAudioSourceIdentity {
  readonly object: string;
  readonly status: string;
  readonly references: readonly string[];
  readonly slots: readonly string[];
}
export interface ActorAudioReportRow {
  readonly key: string;
  readonly sourceIdentity: ActorAudioSourceIdentity;
  readonly played: boolean;
  readonly peak: number | null;
}
export type ActorAudioHarnessState =
  | { readonly state: "loading" }
  | { readonly state: "absent"; readonly bundle: string }
  | { readonly state: "ready"; readonly bundle: string; readonly sounds: number }
  | { readonly state: "playing"; readonly bundle: string }
  | { readonly state: "done"; readonly bundle: string; readonly manifestSha256: string; readonly rows: readonly ActorAudioReportRow[];
      readonly problems: readonly string[] }
  | { readonly state: "failed"; readonly reason: string };

declare global {
  interface Window { __actorAudioHarness?: ActorAudioHarnessState }
}

const lifetime = new AbortController();
const samplingIntervalMilliseconds = 5;
const playbackEndAllowanceSeconds = 5;

function requiredElement<ElementType extends HTMLElement>(id: string, elementType: { new(): ElementType }): ElementType {
  const element = document.getElementById(id);
  if (!(element instanceof elementType)) throw new Error(`Actor sound audition harness page is missing #${id}.`);
  return element;
}

function sourceIdentities(bundle: NativeCombatAudioBundle): Map<string, ActorAudioSourceIdentity> {
  const identities = new Map<string, { object: string; status: string; references: Set<string>; slots: string[] }>();
  for (const selection of bundle.selections) {
    for (const [role, soundSet] of Object.entries(selection.roles)) {
      for (const slot of soundSet.slots) {
        const identity = identities.get(slot.key) ?? { object: slot.object, status: slot.status, references: new Set<string>(), slots: [] };
        identity.references.add(slot.reference);
        identity.slots.push(`${selection.id}/${role}/${soundSet.field}[${slot.index}]`);
        identities.set(slot.key, identity);
      }
    }
  }
  return new Map([...identities].map(([key, identity]) => [key, { object: identity.object, status: identity.status,
    references: [...identity.references].sort(), slots: identity.slots }]));
}

async function playedSound(context: AudioContext, bytes: Uint8Array): Promise<{ played: boolean; peak: number | null; problem: string | null }> {
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(bytes.slice().buffer);
  } catch (error) {
    return { played: false, peak: null, problem: `decodeAudioData refused the sound: ${error instanceof Error ? error.message : String(error)}` };
  }
  const analyser = context.createAnalyser();
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(analyser);
  analyser.connect(context.destination);
  const samples = new Float32Array(analyser.fftSize);
  let peak = 0, sampleReads = 0;
  const sample = () => {
    analyser.getFloatTimeDomainData(samples);
    sampleReads++;
    for (const value of samples) peak = Math.max(peak, Math.abs(value));
  };
  const ended = new Promise<boolean>(resolve => {
    source.onended = () => resolve(true);
    setTimeout(() => resolve(false), (buffer.duration + playbackEndAllowanceSeconds) * 1000);
  });
  const timer = setInterval(sample, samplingIntervalMilliseconds);
  source.start();
  const finished = await ended;
  clearInterval(timer);
  sample();
  source.disconnect();
  analyser.disconnect();
  if (!finished) return { played: false, peak, problem: "playback did not end within its duration plus the allowance" };
  return { played: sampleReads > 0, peak, problem: null };
}

async function playEverySound(bundle: NativeCombatAudioBundle): Promise<ActorAudioHarnessState> {
  const context = new AudioContext();
  try {
    await context.resume();
    const identities = sourceIdentities(bundle), rows: ActorAudioReportRow[] = [], problems: string[] = [];
    const list = requiredElement("actor-audio-rows", HTMLOListElement);
    for (const sound of bundle.sounds) {
      const identity = identities.get(sound.key);
      if (!identity) throw new Error(`sound ${sound.key} is in the bundle but in no admitted slot`);
      const outcome = await playedSound(context, sound.bytes);
      if (outcome.problem) problems.push(`${sound.key}: ${outcome.problem}`);
      rows.push({ key: sound.key, sourceIdentity: identity, played: outcome.played, peak: outcome.peak });
      const item = document.createElement("li");
      item.dataset.actorSound = sound.key;
      item.textContent = `${identity.object} played ${outcome.played} peak ${outcome.peak}`;
      list.append(item);
    }
    return { state: "done", bundle: bundle.id, manifestSha256: bundle.manifestSha256, rows, problems };
  } finally {
    await context.close();
  }
}

async function openBundle(): Promise<void> {
  const bundleId = new URLSearchParams(location.search).get("bundle");
  if (!bundleId) throw new Error("the actor sound audition harness needs ?bundle=<combat-audio record id>");
  const bundle = await loadNativeCombatAudio(lifetime.signal, { id: bundleId });
  const note = requiredElement("actor-audio-note", HTMLParagraphElement);
  if (!bundle) {
    note.textContent = `${bundleId} is not in the served catalog`;
    window.__actorAudioHarness = { state: "absent", bundle: bundleId };
    return;
  }
  note.textContent = `${bundleId}: ${bundle.sounds.length} admitted sounds`;
  const button = requiredElement("actor-audio-play", HTMLButtonElement);
  button.addEventListener("click", () => {
    button.disabled = true;
    window.__actorAudioHarness = { state: "playing", bundle: bundleId };
    playEverySound(bundle).then(state => { window.__actorAudioHarness = state; },
      (error: unknown) => { window.__actorAudioHarness = { state: "failed", reason: error instanceof Error ? error.message : String(error) }; });
  }, { once: true });
  button.disabled = false;
  window.__actorAudioHarness = { state: "ready", bundle: bundleId, sounds: bundle.sounds.length };
}

window.__actorAudioHarness = { state: "loading" };
openBundle().catch((error: unknown) => {
  window.__actorAudioHarness = { state: "failed", reason: error instanceof Error ? error.message : String(error) };
});
