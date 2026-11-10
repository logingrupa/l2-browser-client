import type { NativePlacementAudio } from "../assets/native/loadNativeWorldAudio";
import { WORLD_AUDIO_MAX_BUS_VOLUME, worldAudioLimiterDefaults, type WorldAudioBus, type WorldAudioMixer } from "./WorldAudioMixer";
import { ambienceTimeChoices, nativeAmbientRules, type AmbienceTimeOfDay, type WorldAmbience } from "./worldAmbience";
import { nativeMusicRules, type WorldMusic } from "./worldMusic";
import { musicUnresolvedOutsideVolumesText, musicVolumeSourceText, placementAudioSummaryText, placementAudioSourceText, worldAudioConverterStep } from "./worldAudioSourceTexts";

export interface WorldAudioControlDescription {
  name: string;
  value(): string | number | boolean;
  values: string;
  source: string;
  status: string;
}

export interface WorldAudioCard { testId: string; title: string; description?: string; rows: string[] }

export interface WorldAudioSources {
  music: WorldMusic | null;
  ambience: WorldAmbience | null;
  placementAudio?: NativePlacementAudio | null;
  silentReason?: string | null;
  failure: string | null;
  loading?: boolean;
}

export interface WorldAudioControlOptions {
  music?: WorldMusic | null;
  ambience?: WorldAmbience | null;
  placementAudio?: NativePlacementAudio | null;
  silentReason?: string | null;
  worldAudioFailure?: string | null;
  worldAudioLoading?: boolean;
  refreshIntervalMs?: number;
  isVisible?: () => boolean;
}

export const worldAudioDefaults: Readonly<Record<WorldAudioBus, number>> = { music: 1, ambience: 1, effects: 1 };

export function applyWorldAudioDefaults(mixer: WorldAudioMixer): void {
  for (const bus of ["music", "ambience", "effects"] as const) {
    if (mixer.busState(bus).volume === 1 && worldAudioDefaults[bus] !== 1) mixer.setBusVolume(bus, worldAudioDefaults[bus]);
  }
}

const PRESENTATION = "presentation choice - native rule unverified";
const percent = (value: number) => `${Math.round(value * 100)} %`;
const shortSound = (key: string) => key.split(".").at(-1) ?? key;
const timeLabels: Record<AmbienceTimeOfDay, string> = { auto: "Auto", day: "Day", night: "Night" };

const busInfo: Record<WorldAudioBus, { label: string; max: number; values: string; source: string; status: string }> = {
  music: { label: "Music", max: WORLD_AUDIO_MAX_BUS_VOLUME, values: "0-1000 % (100 % = native gain 0.1), On/Off",
    source: "Effective gain = l2.ini MusicVolume 0.1 (pinned file value, ALAudio PlayMusic gain) × this level",
    status: `100 % is the native file value; boosting above it is a ${PRESENTATION}` },
  ambience: { label: "Ambience", max: 1, values: "0-100 %, On/Off",
    source: "Multiplies the native ambient gain (l2.ini SoundVolume 1.0 and AmbientVolume 1.0, pinned file values)",
    status: `100 % keeps the native file level; the user level is a ${PRESENTATION}` },
  effects: { label: "Effects", max: 1, values: "0-100 %, On/Off",
    source: "Footsteps, hits and action cues (l2.ini SoundVolume 1.0, pinned file value)",
    status: `100 % keeps the native file level; the user level is a ${PRESENTATION}` },
};

function visibleByLayout(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  const check = (element as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
  if (typeof check === "function") return check.call(element);
  return element.getClientRects().length > 0;
}

export function attachWorldAudioControls(host: HTMLElement, mixer: WorldAudioMixer, options: WorldAudioControlOptions = {}) {
  let music = options.music ?? null, ambience = options.ambience ?? null;
  let placementAudio = options.placementAudio ?? null, silentReason = options.silentReason ?? null;
  let failure = options.worldAudioFailure ?? null, loading = options.worldAudioLoading ?? false;
  const minimumRefreshIntervalMs = options.refreshIntervalMs ?? 250;
  const lifetime = new AbortController(), signal = lifetime.signal, root = document.createElement("div");
  const isVisible = options.isVisible ?? (() => visibleByLayout(root));
  root.dataset.testid = "native-audio-controls";
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, testid?: string, textContent?: string, className?: string) => {
    const node = document.createElement(tag);
    if (testid) node.dataset.testid = testid;
    if (textContent) node.textContent = textContent;
    if (className) node.className = className;
    return node;
  };
  applyWorldAudioDefaults(mixer);
  let nextId = 0;
  const createLabelledRow = (testid: string, label: string, alignsSliderOnSharedLevelColumns = false) => {
    const container = element("div", testid, undefined, alignsSliderOnSharedLevelColumns ? "dev-row dev-level-row world-audio-row" : "dev-row world-audio-row");
    container.dataset.info = "";
    const text = element("span", undefined, label, "dev-row-label"), control = element("div", undefined, undefined, "dev-row-control");
    container.append(text, control);
    return { container, text, control };
  };
  const createSegmentedRadioChips = <T extends string>(label: string, testid: string, values: readonly T[], names: Record<T, string>, select: (value: T) => void):
    { group: HTMLDivElement; set: (value: T | null, disabled?: boolean) => void } => {
    const group = element("div", testid, undefined, "dev-chips dev-choice");
    group.dataset.display = "segmented"; group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", label);
    const buttons = values.map(value => {
      const chip = element("button", undefined, names[value], "dev-chip");
      chip.type = "button"; chip.setAttribute("role", "radio"); chip.dataset.value = value; chip.setAttribute("aria-checked", "false");
      chip.addEventListener("click", () => { if (!chip.disabled) { select(value); refresh(); } }, { signal });
      group.append(chip);
      return chip;
    });
    const set = (value: T | null, disabled = false) => {
      for (const chip of buttons) {
        chip.setAttribute("aria-checked", String(chip.dataset.value === value));
        chip.tabIndex = chip.dataset.value === value ? 0 : -1;
        chip.disabled = disabled;
      }
    };
    group.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      const index = buttons.findIndex(chip => chip.getAttribute("aria-checked") === "true");
      const next = buttons[(index + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? buttons.length - 1 : 1)) % buttons.length];
      if (next && !next.disabled) { event.preventDefault(); next.click(); next.focus(); }
    }, { signal });
    return { group, set };
  };
  const createLevelSliderWithReadout = (name: string, testid: string, max: number, value: number) => {
    const input = element("input", `${testid}-input`, undefined, "dev-range"), output = element("output", `${testid}-value`, undefined, "dev-range-value");
    input.type = "range"; input.min = "0"; input.max = String(Math.round(max * 100)); input.step = max > 1 ? "10" : "1";
    input.value = String(Math.round(value * 100)); input.id = `world-audio-range-${nextId++}`; output.setAttribute("for", input.id);
    input.setAttribute("aria-label", `${name} level`);
    output.textContent = percent(value);
    return { input, output };
  };

  const status = element("p", "world-audio-status", undefined, "dev-readout"); status.setAttribute("role", "status");
  const buttons = element("div", undefined, undefined, "secondary-actions");
  const enable = element("button", "enable-world-audio"); enable.type = "button";
  const mute = element("button", "mute-world-audio"); mute.type = "button";
  buttons.append(enable, mute);

  const masterRow = createLabelledRow("world-audio-volume-master", "Master", true);
  const master = createLevelSliderWithReadout("Master", "world-audio-volume-master", 1, mixer.inspection({ levels: false }).volume);
  const emptyMasterToggleSlotKeepingTrackAligned = element("span", undefined, undefined, "dev-level-toggle");
  masterRow.control.append(master.input, master.output, emptyMasterToggleSlotKeepingTrackAligned);
  const musicGainNoteUnderLabel = element("small", "world-audio-volume-music-gain", undefined, "dev-level-note");
  const busControls = Object.fromEntries((["music", "ambience", "effects"] as const).map(bus => {
    const info = busInfo[bus], line = createLabelledRow(`world-audio-volume-${bus}`, bus === "music" ? "Music level" : info.label, true);
    const slider = createLevelSliderWithReadout(info.label, `world-audio-volume-${bus}`, info.max, mixer.busState(bus).volume);
    const toggle = createSegmentedRadioChips(`${info.label} on or off`, `world-audio-mute-${bus}`, ["on", "off"] as const, { on: "On", off: "Off" },
      value => mixer.setBusMuted(bus, value === "off"));
    toggle.group.className += " dev-level-toggle";
    line.control.append(slider.input, slider.output, toggle.group);
    if (bus === "music") line.text.append(musicGainNoteUnderLabel);
    slider.input.addEventListener("input", () => { mixer.setBusVolume(bus, Number(slider.input.value) / 100); refresh(); }, { signal });
    return [bus, { line, slider, toggle }];
  })) as Record<WorldAudioBus, { line: ReturnType<typeof createLabelledRow>; slider: ReturnType<typeof createLevelSliderWithReadout>; toggle: { group: HTMLDivElement; set: (value: "on" | "off" | null, disabled?: boolean) => void } }>;

  const nowRow = element("div", "world-music-now-playing", undefined, "world-audio-readout");
  const nowPlaying = element("p", undefined, undefined, "dev-readout");
  const next = element("button", "world-music-next", "Pick another track"); next.type = "button";
  nowRow.append(nowPlaying);
  const timeRow = createLabelledRow("world-ambience-time", "Game hour");
  const time = createSegmentedRadioChips("Ambient game hour", "world-ambience-time-chips", ambienceTimeChoices, timeLabels, value => ambience?.setTimeOfDay(value));
  timeRow.control.append(time.group);
  const nearbyRow = element("div", "world-ambience-nearby", undefined, "world-audio-readout");
  const nearby = element("p", undefined, undefined, "dev-readout");
  nearbyRow.append(nearby);
  const placementRow = element("div", "world-placement-audio", undefined, "world-audio-readout");
  const placementReadout = element("p", undefined, undefined, "dev-readout");
  placementRow.append(placementReadout);
  root.append(status, buttons, masterRow.container, ...Object.values(busControls).map(control => control.line.container), nowRow, next, timeRow.container, nearbyRow,
    placementRow);
  host.append(root);

  let disposed = false, unlocking = false, lastRefresh = -Infinity;
  const musicText = () => {
    if (!music) {
      if (loading) return "Music loading…";
      if (failure) return `Music unavailable: ${failure}`;
      return `No MusicVolume music loaded${silentReason ? ` (${silentReason})` : ""}: ${musicUnresolvedOutsideVolumesText}.`;
    }
    const state = music.inspection();
    if (!state.enabled) return "Music off.";
    const region = state.volume ? `${state.volume.id.replace("interlude:", "")} · ID ${state.volume.musicId}` : "outside every MusicVolume";
    if (state.track) {
      const position = state.track.positionSeconds === null ? "" : ` ${Math.floor(state.track.positionSeconds)}/${Math.round(state.track.durationSeconds)} s`;
      return `Now playing: ${state.track.storedString}${position} · ${region} · ${state.track.variant === "original" ? "original Ogg" : "AAC derivative"}`;
    }
    if (state.state === "waiting-for-unlock") return `Music ready: ${state.nextPick?.replace("music:", "") ?? "?"} starts on your first tap · ${region}`;
    if (state.state === "loading") return `Music loading ${state.nextPick?.replace("music:", "") ?? ""} · ${region}`;
    if (state.state === "gap") {
      const preRolledNextPickPreloadingDuringGap = state.nextPick ? ` → ${state.nextPick.replace("music:", "")}` : " → new pick";
      return `Gap ${Math.ceil(state.gapRemainingSeconds ?? 0)} s left${preRolledNextPickPreloadingDuringGap} (native ${nativeMusicRules.gapSeconds} s silence after each track) · ${region}`;
    }
    if (state.state === "failed") return `Music failed: ${Object.values(state.failures)[0] ?? "no playable track"}`;
    return state.volume ? `Music: ${region}` : `Music: ${musicUnresolvedOutsideVolumesText}.`;
  };
  const ambienceText = () => {
    if (!ambience) {
      if (loading) return "Ambience loading…";
      if (failure) return `Ambience unavailable: ${failure}`;
      return `No AmbientSoundObject ambience loaded${silentReason ? ` (${silentReason})` : ""}.`;
    }
    const state = ambience.inspection();
    if (!state.enabled) return "Ambience off.";
    const sounds = new Map<string, number[]>();
    for (const loop of state.loops) { const name = shortSound(loop.sound); sounds.set(name, [...(sounds.get(name) ?? []), loop.distance]); }
    const names = [...sounds].slice(0, 4).map(([name, distances]) => `${name} ${Math.round(Math.min(...distances))}${distances.length > 1 ? `-${Math.round(Math.max(...distances))}` : ""} m`).join(", ");
    return `${state.candidates} emitters in range · ${state.gated} gated (${state.isDay ? "day" : "night"}) · ${state.voices.active}/${state.voices.limit} voices: ${state.loops.length} loops${names ? ` (${names})` : ""}, ${state.oneShots.active} one-shots.`;
  };
  const refresh = () => {
    if (disposed) return;
    lastRefresh = performance.now();
    const state = mixer.inspection({ levels: false }), errors = Object.keys(state.decodeErrors).length;
    const playingWhileQueuedDecodesFinish = state.state === "unlocking" && !mixer.locked;
    const running = state.state === "running" || playingWhileQueuedDecodesFinish;
    enable.textContent = unlocking && !running ? "Preparing audio…" : running && !errors ? "Audio enabled" : state.error ? "Retry audio" : "Enable audio";
    enable.disabled = (unlocking && !running) || (running && !errors);
    mute.textContent = state.muted ? "Unmute audio" : "Mute audio"; mute.setAttribute("aria-pressed", String(state.muted));
    status.textContent = state.error ? `Audio unavailable: ${state.error}` :
      running ? `Audio on${state.paused ? " · paused" : state.muted ? " · muted" : ""} · ${state.decoded} sounds decoded${state.queuedDecodes ? ` (${state.queuedDecodes} queued)` : ""}${errors ? ` · ${errors} could not decode (retry)` : ""}.` :
      "Sound starts on your first tap, click or key press.";
    master.output.textContent = percent(state.volume);
    for (const bus of ["music", "ambience", "effects"] as const) {
      const control = busControls[bus], setting = state.buses[bus];
      control.toggle.set(setting.muted ? "off" : "on");
      control.slider.output.textContent = percent(setting.volume);
    }
    musicGainNoteUnderLabel.textContent = `gain ${(state.buses.music.volume * nativeMusicRules.musicVolume).toFixed(2)}`;
    next.disabled = !music || !music.enabled || !music.inspection().volume;
    time.set(ambience?.timeOfDay ?? null, !ambience);
    nowPlaying.textContent = musicText();
    nearby.textContent = ambienceText();
    placementReadout.textContent = loading ? "Placement audio loading…" : placementAudioSummaryText(placementAudio);
  };
  enable.addEventListener("click", () => {
    const unlockResumingContextInsideGesture = mixer.unlock(); unlocking = true; refresh();
    void unlockResumingContextInsideGesture.catch(() => undefined).finally(() => { unlocking = false; refresh(); });
  }, { signal });
  mute.addEventListener("click", () => { mixer.setMuted(!mixer.inspection({ levels: false }).muted); refresh(); }, { signal });
  master.input.addEventListener("input", () => { mixer.setVolume(Number(master.input.value) / 100); refresh(); }, { signal });
  next.addEventListener("click", () => { music?.next(); refresh(); }, { signal });
  const stopRefreshingOnEveryLockChange = mixer.onLockChange(() => refresh());
  signal.addEventListener("abort", stopRefreshingOnEveryLockChange, { once: true });
  refresh();

  const ambienceState = () => ambience?.inspection() ?? null;
  const describe = (): WorldAudioControlDescription[] => {
    const musicState = music?.inspection() ?? null, ambient = ambienceState();
    return [
      { name: "Audio status", value: () => mixer.inspection({ levels: false }).state, values: "locked | unlocking | running | suspended | interrupted | error",
        source: "WorldAudioMixer (one AudioContext); unlocks on the first trusted pointerdown/touchend/click/keydown",
        status: "Browser state. iOS needs touchend/click; the ringer switch is bypassed via navigator.audioSession where supported." },
      { name: "Audio locked", value: () => mixer.locked, values: "true | false (HUD 'Tap anywhere for sound')",
        source: "WorldAudioMixer.locked / onLockChange", status: "Browser state." },
      { name: "Limiter", value: () => { const limiter = mixer.inspection({ levels: false }).limiter; return limiter ? `${limiter.reductionDb === null ? "?" : limiter.reductionDb.toFixed(1)} dB reduction` : "unavailable"; },
        values: `${worldAudioLimiterDefaults.headroomDb} dB headroom, threshold ${worldAudioLimiterDefaults.thresholdDb} dBFS, ratio ${worldAudioLimiterDefaults.ratio}, knee ${worldAudioLimiterDefaults.kneeDb}`,
        source: "Master → headroom gain → DynamicsCompressorNode → analyser → destination", status: `Overlapping cues never clip; ${PRESENTATION}.` },
      { name: "Master volume", value: () => percent(mixer.inspection({ levels: false }).volume), values: "0-100 %",
        source: "WorldAudioMixer master gain", status: `User level; ${PRESENTATION}.` },
      ...(["music", "ambience", "effects"] as const).map(bus => ({
        name: bus === "music" ? "Music level" : `${busInfo[bus].label} volume`,
        value: () => { const setting = mixer.busState(bus); return `${percent(setting.volume)}${setting.muted ? " (off)" : ""}${bus === "music" ? ` → gain ${(setting.volume * nativeMusicRules.musicVolume).toFixed(2)}` : ""}`; },
        values: busInfo[bus].values, source: `${busInfo[bus].source}. Bus voice limit ${mixer.inspection({ levels: false }).buses[bus].limit}`, status: busInfo[bus].status })),
      { name: "Now playing", value: () => { const track = music?.inspection().track; return track ? `${track.storedString} (${track.variant})` : music?.inspection().state ?? "not staged"; },
        values: musicState ? (musicState.candidates.length ? musicState.candidates.map(key => key.replace("music:", "")).map(name => musicState.track?.storedString === name ? `[${name}]` : name).join(" | ") : "outside every MusicVolume: none") : "no music loaded",
        source: musicState ? musicVolumeSourceText(musicState) : `MusicVolume → nMusicID → musicinfo.dat strings → original music/*.ogg, converted by ${worldAudioConverterStep}`,
        status: "Track list from source data; the uniform random pick (GetMusicName names[appRand() % count]) is a research reading, native audible parity unverified." },
      { name: "Music rule", value: () => { const state = music?.inspection(); return state ? `${state.state}${state.gapRemainingSeconds !== null ? ` (${Math.ceil(state.gapRemainingSeconds)} s left${state.nextPick ? `, next ${state.nextPick.replace("music:", "")} pre-rolled to preload` : ""})` : ""}${state.fading.length ? ` · fading ${state.fading.join(", ")}` : ""}` : "n/a"; },
        values: `uniform random · no loop · no fade-in · ${nativeMusicRules.gapSeconds} s gap then re-pick · ${nativeMusicRules.changeFadeSeconds} s linear fade-out on volume change · finish-then-silence outside volumes`,
        source: nativeMusicRules.evidence, status: "Research reading of the bytes (REPORT.md Q2); selection, looping and silence outside volumes are unverified against the native client." },
      { name: "Music region", value: () => music?.inspection().volume?.id ?? "outside every MusicVolume",
        values: music ? music.volumes.map(volume => `${volume.object} (ID ${volume.musicId}${volume.forcePlayMusic ? ", bForcePlayMusic" : ""})`).join(" | ") : "no music loaded",
        source: `MusicVolume brush BSP planes of ${musicState?.sourceMap ?? "the map"}, converted by ${worldAudioConverterStep} (world = Location + (local − PrePivot); inside when every plane gives nx*X + ny*Y + nz*Z - W <= 0); a later overlapping volume wins only with bForcePlayMusic`,
        status: "Lookup read from L2GetMusicVolume via ALineagePlayerController::Tick (REPORT.md Q2); volume selection parity unverified." },
      { name: "Music listener", value: () => "local pawn", values: "local pawn",
        source: "Native tests Pawn.Location; the browser uses the local fighter position plus its collision height",
        status: `Pawn stands in for Pawn.Location; ${PRESENTATION} for the exact point.` },
      { name: "Music format", value: () => { const track = music?.inspection().track; return track ? (track.variant === "original" ? "original Ogg (restored L2SD capture)" : "AAC derivative") : "n/a"; },
        values: "original Ogg | AAC derivative (fallback)", source: "Streamed via HTMLMediaElement → MediaElementAudioSourceNode from hash-verified bytes",
        status: `Streaming and the AAC fallback for browsers without Ogg Vorbis are a ${PRESENTATION}.` },
      { name: "Ambient game hour", value: () => { const state = ambienceState(); return state ? `${timeLabels[state.timeOfDay]} → ${state.isDay ? "Day" : "Night"} (hour ${state.hour.toFixed(1)})` : "n/a"; },
        values: "Auto (local clock) | Day | Night; Day = hour >= 6",
        source: "AmbientSoundType Day/Night gate (ALAudio IsSoundDay/IsSoundNight); the native game-hour writer is unknown",
        status: `Hour source is a ${PRESENTATION} (Auto = this device's clock).` },
      { name: "Nearby ambient emitters", value: () => { const state = ambienceState(); return state ? `${state.candidates} in range · ${state.inRange} eligible · ${state.gated} gated` : 0; },
        values: ambient ? `${ambient.emitters} AmbientSoundObject emitters; candidate when distance <= SoundRadius × ${ambient.radiusMultiplier}` : "no ambience loaded",
        source: `AmbientSoundObject fields of ${ambient?.sourceMap ?? "the map"}, converted by ${worldAudioConverterStep}; omitted fields use Engine.u class defaults`,
        status: "Native range rule and class defaults (REPORT.md Q3)." },
      { name: "Ambient voices", value: () => { const state = ambienceState(); return state ? `${state.voices.active}/${state.voices.limit} (${state.loops.length} loops, ${state.oneShots.active} one-shots, ${state.oneShots.skippedForVoices} skipped)` : "n/a"; },
        values: `${nativeAmbientRules.slots} slots (native); ≤ ${ambient?.voices.loopLimit ?? 8} loops loudest-first`,
        source: "ALAudio.int [AmbientSound] AmbientSoundSlot=16; same object never twice",
        status: `Slot count is native; the loop cap and loudest-first priority are a ${PRESENTATION}.` },
      { name: "Ambient gain rule", value: () => { const loop = ambienceState()?.loops[0]; return loop ? `${shortSound(loop.sound)} ${loop.distance.toFixed(1)} m → ${loop.gain.toFixed(3)}` : "no loop playing"; },
        values: "gain = (Vol/255) × SoundVolume × (50R − d)/(50R) × R/(R + 0.5(d − R)); rate = clamp(Pitch/64, 0.5, 2); Random 100 loops, 1-99 one roll per WAV length from StartTime",
        source: nativeAmbientRules.evidence, status: "Formula read from the bytes (REPORT.md Q3); browser gain parity unverified." },
      { name: "Ambient listener", value: () => "local pawn", values: "local pawn",
        source: "Native listener comes from the render scene node (camera or pawn not proved)",
        status: `Local pawn Location; ${PRESENTATION}.` },
      { name: "Ambient range multiplier", value: () => ambienceState()?.radiusMultiplier ?? "n/a", values: "SoundRadius × multiplier (source units)",
        source: "Original Core.dll export ?GAudioMaxRadiusMultiplier@@3MA (static initializer)",
        status: "Static native value (REPORT.md Q3: never written)." },
      { name: "Placement audio", value: () => placementAudioSummaryText(placementAudio),
        values: "StepSound bindings per StaticMeshActor placement",
        source: placementAudioSourceText(placementAudio),
        status: "Bound sounds are source facts; automatic surface footstep playback is a polish item (DEC-OWN-1) and is not presented." },
    ];
  };

  const cards = (): WorldAudioCard[] => [
    { testId: "world-audio-status", title: "Audio status", description: "Sound starts on the first trusted tap, click or key press anywhere. Enable audio retries if the browser refused.", rows: ["Audio status", "Audio locked", "Limiter"] },
    { testId: "world-audio-volume-master", title: "Master volume", rows: ["Master volume", "Limiter"] },
    { testId: "world-audio-volume-music", title: "Music level", description: "100 % plays at the native l2.ini MusicVolume 0.1. Raise it up to 1000 % to boost (presentation choice).", rows: ["Music level"] },
    { testId: "world-audio-volume-ambience", title: "Ambience volume", rows: ["Ambience volume"] },
    { testId: "world-audio-volume-effects", title: "Effects volume", rows: ["Effects volume", "Limiter"] },
    { testId: "world-music-now-playing", title: "Now playing",
      description: `${music ? musicVolumeSourceText(music.inspection()) : `No MusicVolume music loaded: ${musicUnresolvedOutsideVolumesText}`}. Playback: a uniform random pick, no loop, 30 s of silence then another pick (research reading, unverified).`,
      rows: ["Now playing", "Music rule", "Music region", "Music listener", "Music format"] },
    { testId: "world-ambience-time", title: "Ambient game hour", description: "Day sounds play from 06:00, Night sounds before. Auto uses this device's clock (presentation choice).", rows: ["Ambient game hour"] },
    { testId: "world-ambience-nearby", title: "Nearby ambient emitters", description: "Original AmbientSoundObject emitters around the fighter, with the native range, gain and one-shot rules.", rows: ["Nearby ambient emitters", "Ambient voices", "Ambient gain rule", "Ambient listener", "Ambient range multiplier"] },
    { testId: "world-placement-audio", title: "Placement audio", description: "StepSound sounds bound to static mesh placements as authored. Automatic surface footstep playback is a polish item (DEC-OWN-1).", rows: ["Placement audio"] },
  ];

  return {
    update(force = false) {
      if (disposed || (!force && performance.now() - lastRefresh < minimumRefreshIntervalMs)) return;
      if (!force && !isVisible()) { lastRefresh = performance.now(); return; }
      refresh();
    },
    describe,
    cards,
    setWorldAudio(sources: WorldAudioSources) {
      if (disposed) return;
      music = sources.music; ambience = sources.ambience; failure = sources.failure; loading = sources.loading ?? false;
      placementAudio = sources.placementAudio ?? null; silentReason = sources.silentReason ?? null;
      refresh();
    },
    dispose() { if (disposed) return; disposed = true; lifetime.abort(); root.remove(); },
  };
}
