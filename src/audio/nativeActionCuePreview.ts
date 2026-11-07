import { sha256, validatePackageModel, type AssetPackage } from "../assets/package/readAssetPackage";
import type { NativeActorClock } from "../assets/native/NativeActor";
import type { WorldAudioMixer, WorldAudioPlaybackReceipt } from "./WorldAudioMixer";
import { nativePawnSoundLedger } from "./nativePawnSounds";

/** Deliberately narrow source-cue preview, not a native sound backend. Evidence:
 * artifacts/native-parity/research/native-world-audio-20261106/death-cue-tuples.json
 * SHA256 fe0ea0a71ce1bbf3d120504920c4acb0f3d68f3cf4afe763aed132175c11a62b.
 * Attack source: backend-closure/retained-backend-inventory.json nextCandidate,
 * SHA256 7d73bc59436bdab0c286df4fc442c6cc36714b0ce747610a1286fbea5d8b3e89.
 * Female source/package byte joins:
 * artifacts/native-parity/research/native-ffighter-world-20261107/audio/SOURCE_CUES.json.
 * Raw native volume/radius/random values are identity checks, NOT browser policy.
 * Archive integrity belongs to loadNativeCatalog/readAssetPackage upstream. */
const sources = [
  { catalogId: "human-male-fighter:0", assetId: "interlude:assembly:MFighter-native-body-face0-hair0",
    object: "Fighter.MFighter_m001_u", sourceSha256: "8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c",
    animationSet: "Fighter.MFighter_anim", clip: "Death_MFighter", frames: 51, rate: 15, radius: 30,
    cues: [
      { notify: "Fighter.AnimNotify_Sound756", time: 0.006666667060926557,
        sound: "ChrSound.MHFighter_Basic_Action.MHFighter_Death", sourceObject: "chrsound.MHFighter_Basic_Action.MHFighter_Death",
        sourceSha256: "a0afd64d23e7e2c89d2d89b196dc082080da89b17bfd6ac3e15ae0bb2d5b919e",
        sha256: "19ecfffc7fb5ce6c6abb394b30b77a96d60c5daa9551351d58c5c8ac29ed255f", bytes: 105086 },
      // This surprising silenos identity is authored in the fighter package.
      { notify: "Fighter.AnimNotify_Sound757", time: 0.686666676402092,
        sound: "MonSound2.heltor_silenos.h_silenos_wait_alt_1", sourceObject: "monsound2.heltor_silenos.h_silenos_wait_alt_1",
        sourceSha256: "f2ab082d2a4f2f5541c1194d823364c3eb5c4383c3fbf8b9d5aa060c0ea2cb19",
        sha256: "3e4322c78028df08dfaae2ff8e4de07bc5fe5508fc4357898d84f01e01ce40c0", bytes: 85718 },
      { notify: "Fighter.AnimNotify_Sound758", time: 1.3866665840148926,
        sound: "ChrSound.Character_Public.Death_Fall_Knee", sourceObject: "chrsound.Character_Public.Death_Fall_Knee",
        sourceSha256: "a0afd64d23e7e2c89d2d89b196dc082080da89b17bfd6ac3e15ae0bb2d5b919e",
        sha256: "b3da52fd999593b047ff0294c3513bab8a78c912d0b3b57b0c933ac8a89392ca", bytes: 25188 },
      { notify: "Fighter.AnimNotify_Sound759", time: 2.4666667222976684,
        sound: "ChrSound.Character_Public.Death_Fall_Light", sourceObject: "chrsound.Character_Public.Death_Fall_Light",
        sourceSha256: "a0afd64d23e7e2c89d2d89b196dc082080da89b17bfd6ac3e15ae0bb2d5b919e",
        sha256: "ee160202d59a7109aad53bfbe65314b891defc67ea839d4adfd347e784bef755", bytes: 36036 },
    ] },
  { catalogId: "musveren:0", assetId: "interlude:LineageMonsters.field_stalker_m00",
    object: "LineageMonsters.field_stalker_m00", sourceSha256: "157715304bfb1f289ce6bf202e5651f3809f57d5b061239db0c6a2a817c9a9c9",
    animationSet: "LineageMonsters.field_stalker_anim", clip: "death", frames: 91, rate: 30, radius: 50,
    cues: [
      { notify: "LineageMonsters.AnimNotify_Sound2859", time: 0.03333333417152365,
        sound: "MonSound.field_stalker.field_stalker_death", sourceObject: "monsound.field_stalker.field_stalker_death",
        sourceSha256: "8386ca2cbf0d45a7bca1a32d2139317c3d0bcaf62b5bd88ba80ac326af372b26",
        sha256: "125b0af9b6be4bd8e413100f0377f6d6466b8bd317b5cfcc6a006bc663037573", bytes: 132694 },
      { notify: "LineageMonsters.AnimNotify_Sound2860", time: 0.03333333417152365,
        sound: "MonSound.field_stalker.field_stalker_fall", sourceObject: "monsound.field_stalker.field_stalker_fall",
        sourceSha256: "8386ca2cbf0d45a7bca1a32d2139317c3d0bcaf62b5bd88ba80ac326af372b26",
        sha256: "f9d2063509e8a2cc72167724ecadb365a952fe01d7845793487ebcd40adea64f", bytes: 169720 },
    ] },
  { catalogId: "musveren:0", assetId: "interlude:LineageMonsters.field_stalker_m00",
    object: "LineageMonsters.field_stalker_m00", sourceSha256: "157715304bfb1f289ce6bf202e5651f3809f57d5b061239db0c6a2a817c9a9c9",
    animationSet: "LineageMonsters.field_stalker_anim", clip: "atk01", frames: 55, rate: 30, radius: 50,
    cues: [
      { notify: "LineageMonsters.AnimNotify_Sound2855", time: 0.033333332277834415,
        sound: "MonSound.field_stalker.field_stalker_walk_loop", sourceObject: "monsound.field_stalker.field_stalker_walk_loop",
        sourceSha256: "8386ca2cbf0d45a7bca1a32d2139317c3d0bcaf62b5bd88ba80ac326af372b26",
        sha256: "e3724120f7225cb653a00ac2794934fc07bb9c1beed1e1f149a03afd114243ac", bytes: 86148 },
      { notify: "LineageMonsters.AnimNotify_Sound2851", time: 0.2666666582226753,
        sound: "MonSound.field_stalker.field_stalker_atk", sourceObject: "monsound.field_stalker.field_stalker_atk",
        sourceSha256: "8386ca2cbf0d45a7bca1a32d2139317c3d0bcaf62b5bd88ba80ac326af372b26",
        sha256: "fb51d744ed9214833704f0ce0fd709a6d6118bcc8689c6168c666656b339f236", bytes: 44518 },
      { notify: "LineageMonsters.AnimNotify_Sound2852", time: 0.5000000149011612,
        sound: "MonSound.field_stalker.field_stalker_swish", sourceObject: "monsound.field_stalker.field_stalker_swish",
        sourceSha256: "8386ca2cbf0d45a7bca1a32d2139317c3d0bcaf62b5bd88ba80ac326af372b26",
        sha256: "75c365cd28cc9711cfa57b3e7c6d6ff3c366cd8305a781774c337de137a8ab62", bytes: 46764 },
    ] },
  { catalogId: "human-female-fighter:0", assetId: "interlude:assembly:FFighter-native-body-face0-hair0",
    object: "Fighter.FFighter_m001_u", sourceSha256: "8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c",
    animationSet: "Fighter.FFighter_anim", clip: "Death_FFighter", frames: 41, rate: 16, radius: 30,
    cues: [
      // Source-authored silenos cue, independently matched to original UAX bytes.
      { notify: "Fighter.AnimNotify_Sound234", time: 0.21250000735744834,
        sound: "MonSound2.heltor_silenos.h_silenos_wait_alt_1", sourceObject: "monsound2.heltor_silenos.h_silenos_wait_alt_1",
        sourceSha256: "f2ab082d2a4f2f5541c1194d823364c3eb5c4383c3fbf8b9d5aa060c0ea2cb19",
        sha256: "3e4322c78028df08dfaae2ff8e4de07bc5fe5508fc4357898d84f01e01ce40c0", bytes: 85718 },
      { notify: "Fighter.AnimNotify_Sound235", time: 0.4250000147148967,
        sound: "ChrSound.FHFighter_Basic_Action.FHFighter_Death", sourceObject: "chrsound.FHFighter_Basic_Action.FHFighter_Death",
        sourceSha256: "a0afd64d23e7e2c89d2d89b196dc082080da89b17bfd6ac3e15ae0bb2d5b919e",
        sha256: "b3ec5c225ab495e266c3a99b402ffba071fff87e4b336e04437473f6ebbc20e2", bytes: 90040 },
      { notify: "Fighter.AnimNotify_Sound236", time: 1.1000000201165676,
        sound: "ChrSound.Character_Public.Death_Fall_Knee", sourceObject: "chrsound.Character_Public.Death_Fall_Knee",
        sourceSha256: "a0afd64d23e7e2c89d2d89b196dc082080da89b17bfd6ac3e15ae0bb2d5b919e",
        sha256: "b3da52fd999593b047ff0294c3513bab8a78c912d0b3b57b0c933ac8a89392ca", bytes: 25188 },
      { notify: "Fighter.AnimNotify_Sound237", time: 2.1812500581145287,
        sound: "ChrSound.Character_Public.Death_Fall_Light", sourceObject: "chrsound.Character_Public.Death_Fall_Light",
        sourceSha256: "a0afd64d23e7e2c89d2d89b196dc082080da89b17bfd6ac3e15ae0bb2d5b919e",
        sha256: "ee160202d59a7109aad53bfbe65314b891defc67ea839d4adfd347e784bef755", bytes: 36036 },
    ] },
  { catalogId: "human-female-fighter:0", assetId: "interlude:assembly:FFighter-native-body-face0-hair0",
    object: "Fighter.FFighter_m001_u", sourceSha256: "8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c",
    animationSet: "Fighter.FFighter_anim", clip: "Atk01_Hand_FFighter", frames: 46, rate: 30, radius: 30,
    // Six specialized notifications have no direct Sound reference. Report
    // their uncovered coverage without inventing voice, weapon or impact cues.
    cues: [] },
  { catalogId: "human-male-fighter:0", assetId: "interlude:assembly:MFighter-native-body-face0-hair0",
    object: "Fighter.MFighter_m001_u", sourceSha256: "8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c",
    animationSet: "Fighter.MFighter_anim", clip: "Atk01_Hand_MFighter", frames: 43, rate: 30, radius: 30,
    // The male Hand attack has the same six specialized-event coverage gap.
    cues: [] },
] as const;

/** Opt-in source clip preview. These cues belong to these exact special clips,
 * not the normal Hand attack or an inferred skill/DAT timeline. Source tuples:
 * native-human-skill-audio-20261107/attack-source/DIRECT_SPECIAL_CUES.json
 * SHA256 84565484fcb7bb70780996c19a62009ee74141af365cb430e248329737bbd369. */
const humanSpecialSources = [
  { catalogId: "human-male-fighter:0", assetId: "interlude:assembly:MFighter-native-body-face0-hair0",
    object: "Fighter.MFighter_m001_u", sourceSha256: "8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c",
    animationSet: "Fighter.MFighter_anim", clip: "SpAtk01_1HS_MFighter", frames: 47, rate: 30, radius: 30,
    cues: [
      { notify: "Fighter.AnimNotify_Sound681", time: 0.0033333332277834414,
        sound: "ChrSound.MHFighter_Special_Attack.MHFighter_Preatk_1", sourceObject: "chrsound.MHFighter_Special_Attack.MHFighter_Preatk_1",
        sourceSha256: "a0afd64d23e7e2c89d2d89b196dc082080da89b17bfd6ac3e15ae0bb2d5b919e",
        sha256: "ffcecdad134afd0c86e8dd796ae6b8e6917c2210b1b4ee4bd6340702d94b4442", bytes: 35992 },
      { notify: "Fighter.AnimNotify_Sound682", time: 0.6333333512147268,
        sound: "ChrSound.Step_Stone_Gritty.Stone_Gritty_Walk_01", sourceObject: "chrsound.Step_Stone_Gritty.Stone_Gritty_Walk_01",
        sourceSha256: "a0afd64d23e7e2c89d2d89b196dc082080da89b17bfd6ac3e15ae0bb2d5b919e",
        sha256: "5468d722103821f9db16b829fd0071af102bf99b65ef5248e9a95bb3ff3835f3", bytes: 6742 },
      { notify: "Fighter.AnimNotify_Sound683", time: 0.7533333649237951,
        sound: "ChrSound.MHFighter_Special_Attack.MHFighter_2H_S_Atk_2", sourceObject: "chrsound.MHFighter_Special_Attack.MHFighter_2H_S_Atk_2",
        sourceSha256: "a0afd64d23e7e2c89d2d89b196dc082080da89b17bfd6ac3e15ae0bb2d5b919e",
        sha256: "5167a0fa875c220d66dea0192034c710cc2d93d5b69835b9cace696501404160", bytes: 16968 },
      { notify: "Fighter.AnimNotify_Sound684", time: 0.9633333305517833,
        sound: "ChrSound.Character_Public.Death_Fall_Light", sourceObject: "chrsound.Character_Public.Death_Fall_Light",
        sourceSha256: "a0afd64d23e7e2c89d2d89b196dc082080da89b17bfd6ac3e15ae0bb2d5b919e",
        sha256: "ee160202d59a7109aad53bfbe65314b891defc67ea839d4adfd347e784bef755", bytes: 36036 },
    ] },
  { catalogId: "human-female-fighter:0", assetId: "interlude:assembly:FFighter-native-body-face0-hair0",
    object: "Fighter.FFighter_m001_u", sourceSha256: "8a22d41ceaa78d52a10b856b923462eb8eb08d61b203d0d7904e464857ae988c",
    animationSet: "Fighter.FFighter_anim", clip: "SpAtk01_1HS_FFighter", frames: 47, rate: 30, radius: 30,
    cues: [
      { notify: "Fighter.AnimNotify_Sound263", time: 0.0033333332277834414,
        sound: "ChrSound.FHFighter_Special_Attack.FHFighter_Preatk_1", sourceObject: "chrsound.FHFighter_Special_Attack.FHFighter_Preatk_1",
        sourceSha256: "a0afd64d23e7e2c89d2d89b196dc082080da89b17bfd6ac3e15ae0bb2d5b919e",
        sha256: "7dc7293066d9d08be0463c39b19efab37651f9846c57df5580f37c7559f02ebd", bytes: 32998 },
      { notify: "Fighter.AnimNotify_Sound264", time: 0.5866666714350383,
        sound: "ItemSound.Weapon_Fist.fist_2", sourceObject: "itemsound.Weapon_Fist.fist_2",
        sourceSha256: "e16cd1701b485f4b76de4938af5674699b8622cb6e0c418c2c313044c485365d",
        sha256: "a352d22e8f2ca23e47520034d39ea98620c514d5e01abbcd820c67eb28165bc3", bytes: 19596 },
      { notify: "Fighter.AnimNotify_Sound265", time: 0.7866666475931803,
        sound: "ChrSound.FHFighter_Normal_Attack.FHFighter_2H_Atk_5", sourceObject: "chrsound.FHFighter_Normal_Attack.FHFighter_2H_Atk_5",
        sourceSha256: "a0afd64d23e7e2c89d2d89b196dc082080da89b17bfd6ac3e15ae0bb2d5b919e",
        sha256: "380f4115d82258676385b3c7e4aa37283271e2fb55208f71b3bbd46c9f8bdc11", bytes: 21894 },
      { notify: "Fighter.AnimNotify_Sound266", time: 0.8800000071525573,
        sound: "ChrSound.Character_Public.Death_Fall_Light", sourceObject: "chrsound.Character_Public.Death_Fall_Light",
        sourceSha256: "a0afd64d23e7e2c89d2d89b196dc082080da89b17bfd6ac3e15ae0bb2d5b919e",
        sha256: "ee160202d59a7109aad53bfbe65314b891defc67ea839d4adfd347e784bef755", bytes: 36036 },
    ] },
] as const;

interface Cue { key: string; notify: string; sound: string; sourceObject: string; time: number }
interface AdmittedClip { clip: string; duration: number; cues: readonly Cue[] }
export interface NativeActionCueDiagnostic { assetId: string; clip: string; notify: string | null; reason: string }
export interface NativeActionCueCoverage {
  assetId: string; clip: string; admitted: number;
  uncovered: { notify: string; type: string; timeSeconds: number; reason: string }[];
}
export interface NativeActionCueDispatch {
  owner: string; generation: number; clip: string; notify: string; sound: string;
  sourceTimeSeconds: number; observedTimeSeconds: number; offsetSeconds: number;
  accepted: boolean; playback: WorldAudioPlaybackReceipt | null;
}
export interface NativeActionCuePlayer {
  start(clock: NativeActorClock): void;
  advance(previous: NativeActorClock, current: NativeActorClock): void;
  dispose(): void;
}
export interface NativeActionCuePreview {
  bindActor(owner: string, asset: AssetPackage): NativeActionCuePlayer;
  inspection(): { policy: "source-cue-preview"; nativeBackendVerified: false; available: number; played: number; dropped: number;
    activeOwners: number; diagnostics: readonly NativeActionCueDiagnostic[]; recent: readonly NativeActionCueDispatch[];
    coverage: readonly NativeActionCueCoverage[]; disposed: boolean };
  dispose(): void;
}
export interface NativeActionCuePreviewOptions {
  /** Omitted preserves the original male-fighter/Musveren preview. Explicit
   * selection limits validation and diagnostics to the active route's actors. */
  activeCatalogIds?: readonly string[];
  /** Explicitly include the pinned human SpAtk01_1HS source-cue previews.
   * Omission preserves historical cue admission and playback behavior. */
  includeHumanSpecialAttackCues?: boolean;
}
type Mixer = Pick<WorldAudioMixer, "register" | "play" | "stopOwner">;
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function requireMatch(condition: boolean, reason: string): asserts condition { if (!condition) throw new Error(reason); }
async function verifiedFile(asset: AssetPackage, path: string): Promise<Uint8Array> {
  const files = asset.manifest.files.filter(file => file.path === path), bytes = asset.files.get(path);
  requireMatch(files.length === 1 && !!bytes, `Missing or ambiguous file: ${path}`);
  requireMatch(bytes.length === files[0]!.bytes && await sha256(bytes) === files[0]!.sha256, `File identity mismatch: ${path}`);
  return bytes;
}

/** Validate before registering. Missing/changed source cues are diagnostics;
 * they never become guessed aliases or block an otherwise valid visual model. */
export async function createNativeActionCuePreview(assets: ReadonlyMap<string, AssetPackage>, mixer: Mixer,
  options: NativeActionCuePreviewOptions = {}): Promise<NativeActionCuePreview> {
  const activeCatalogIds = new Set(options.activeCatalogIds ?? ["human-male-fighter:0", "musveren:0"]);
  const admitted = new Map<AssetPackage, Map<string, AdmittedClip>>(), registered = new Set<string>();
  const verifiedAssets = new Map<AssetPackage, { animations: ReturnType<typeof validatePackageModel>["animations"]; eventAudio: Record<string, unknown> }>();
  const diagnostics: NativeActionCueDiagnostic[] = [], recent: NativeActionCueDispatch[] = [], coverage: NativeActionCueCoverage[] = [];
  const owners = new Set<NativeActionCuePlayer>();
  let disposed = false, nextOwner = 0, played = 0, dropped = 0;
  const selectedSources = options.includeHumanSpecialAttackCues === true ? [...sources, ...humanSpecialSources] : sources;
  for (const source of selectedSources) {
    if (!activeCatalogIds.has(source.catalogId)) continue;
    const asset = assets.get(source.catalogId);
    const report: NativeActionCueCoverage = { assetId: source.assetId, clip: source.clip, admitted: 0, uncovered: [] };
    coverage.push(report);
    const reject = (reason: unknown, notify: string | null = null) => diagnostics.push({ assetId: source.assetId, clip: source.clip, notify,
      reason: reason instanceof Error ? reason.message : String(reason) });
    try {
      requireMatch(!!asset, `Missing catalog asset: ${source.catalogId}`);
      requireMatch(asset.manifest.id === source.assetId && asset.manifest.kind === "model" &&
        asset.manifest.source.edition === "interlude" && asset.manifest.source.object === source.object &&
        asset.manifest.source.sha256 === source.sourceSha256, "Source asset identity mismatch");
      let verified = verifiedAssets.get(asset);
      if (!verified) {
        const glb = await verifiedFile(asset, asset.manifest.model?.file ?? "");
        const provenance = record(JSON.parse(new TextDecoder().decode(await verifiedFile(asset, "provenance.json"))));
        verified = { animations: validatePackageModel(glb).animations, eventAudio: record(record(provenance.metadata).eventAudio) };
        verifiedAssets.set(asset, verified);
      }
      const clips = verified.animations.filter(clip => clip.name === source.clip);
      requireMatch(clips.length === 1 && clips[0]!.nativeDurationSeconds === source.frames / source.rate, "Source clip duration or identity mismatch");
      const eventAudio = verified.eventAudio;
      const clipEvents = (asset.manifest.animationEvents ?? []).map(record).filter(event => event.clip === source.clip);
      // Unimplemented event classes are coverage gaps, not malformed packages
      // and not evidence of silence. Never infer dispatch from their names.
      report.uncovered = clipEvents.filter(event => !source.cues.some(cue => cue.notify === event.object)).map(event => ({
        notify: String(event.object), type: String(event.type), timeSeconds: Number(event.timeSeconds),
        reason: "Source event is not admitted by this cue preview; sound dispatch remains unverified.",
      }));
      const cues: Cue[] = [];
      for (const expected of source.cues) {
        try {
          const events = (asset.manifest.animationEvents ?? []).map(record).filter(event => event.object === expected.notify && event.clip === source.clip);
          requireMatch(events.length === 1, "Missing or ambiguous source notification");
          const event = events[0]!, properties = record(event.properties), file = `audio/${expected.sourceObject}.wav`;
          requireMatch(event.animationSet === source.animationSet && event.type === "AnimNotify_Sound" && event.function === "None" &&
            event.timeSeconds === expected.time && event.sourceFrames === source.frames && event.sourceRate === source.rate &&
            typeof event.normalizedTime === "number" && event.normalizedTime * (source.frames / source.rate) === expected.time &&
            event.sound === expected.sound && event.resolvedFile === file && properties.Sound === expected.sound &&
            properties.Volume === 250 && properties.Radius === source.radius && properties.Random === undefined,
          "Source notification tuple mismatch");
          const origin = record(eventAudio[expected.sound]), audio = record(origin.audio);
          requireMatch(origin.file === file && origin.sourceObject === expected.sourceObject && origin.sourceSha256 === expected.sourceSha256 &&
            audio.nativePayloadSha256 === expected.sha256 && audio.outputSha256 === expected.sha256 && audio.encodedAudioUnchanged === true,
          "Source audio provenance mismatch");
          const bytes = await verifiedFile(asset, file), entry = asset.manifest.files.find(entry => entry.path === file)!;
          requireMatch(entry.sha256 === expected.sha256 && bytes.length === expected.bytes && entry.mime === "audio/wav", "Pinned audio payload mismatch");
          const key = `native-action:${expected.sha256}`;
          if (!registered.has(key)) { mixer.register(key, bytes); registered.add(key); }
          cues.push({ key, notify: expected.notify, sound: expected.sound, sourceObject: expected.sourceObject, time: expected.time });
        } catch (error) { reject(error, expected.notify); }
      }
      const clipsForAsset = admitted.get(asset) ?? new Map<string, AdmittedClip>();
      clipsForAsset.set(source.clip, { clip: source.clip, duration: source.frames / source.rate, cues });
      admitted.set(asset, clipsForAsset);
      report.admitted = cues.length;
    } catch (error) { reject(error); }
  }
  const available = coverage.reduce((sum, clip) => sum + clip.admitted, 0);
  // Direct cues register in the shared per-pawn ledger, so the combat
  // AttackItem/AttackVoice routes see them through the native IsPlaying skip.
  const pawnSounds = nativePawnSoundLedger(mixer);
  return {
    bindActor(entityId, asset) {
      const clips = admitted.get(asset), owner = `native-action:${++nextOwner}:${entityId}`;
      const stop = () => { mixer.stopOwner(owner); pawnSounds.release(owner); };
      let selected: AdmittedClip | undefined;
      let released = disposed, generation = 0, active = false, cursor = 0;
      const consumed = new Set<string>();
      const matches = (clock: NativeActorClock) => !!selected && clock.clip === selected.clip && clock.mode === "once" && clock.durationSeconds === selected.duration;
      if (!clips && !disposed && !diagnostics.some(item => item.assetId === asset.manifest.id && item.notify === null)) {
        diagnostics.push({ assetId: asset.manifest.id, clip: "", notify: null, reason: "No verified action-cue source for this asset instance" });
      }
      const player: NativeActionCuePlayer = {
        start(clock) {
          if (released) return;
          stop(); generation++; consumed.clear(); cursor = clock.elapsedSeconds;
          selected = clock.clip ? clips?.get(clock.clip) : undefined;
          active = matches(clock) && clock.elapsedSeconds === 0;
        },
        advance(previous, current) {
          if (released || !active || !selected) return;
          if (!matches(previous) || !matches(current) || !Number.isFinite(current.elapsedSeconds) || current.elapsedSeconds < cursor) {
            active = false; stop(); return;
          }
          const start = Math.max(cursor, previous.elapsedSeconds), end = Math.min(current.elapsedSeconds, selected.duration);
          // Consume even when playback is paused/locked; no queue or late replay.
          cursor = end;
          for (const cue of selected.cues) {
            if (consumed.has(cue.notify) || cue.time <= start || cue.time > end) continue;
            consumed.add(cue.notify);
            const offset = end - cue.time;
            const playback = previous.playing ? mixer.play(cue.key, owner, offset) : null;
            if (playback) {
              played++;
              pawnSounds.started(entityId, cue.sourceObject, owner, playback.contextTime + playback.durationSeconds - playback.offsetSeconds);
            } else dropped++;
            recent.push({ owner: entityId, generation, clip: selected.clip, notify: cue.notify, sound: cue.sound,
              sourceTimeSeconds: cue.time, observedTimeSeconds: end, offsetSeconds: offset, accepted: !!playback, playback });
            if (recent.length > 64) recent.shift();
          }
          // A held completed pose keeps its tail. A subsequent action/idle
          // start stops it, including the driver's attack -> idle transition.
          // This remains explicit browser-preview policy, not a native rule.
          if (current.completed) active = false;
        },
        dispose() {
          if (released) return;
          released = true; active = false; stop(); owners.delete(player);
        },
      };
      if (!released) owners.add(player);
      return player;
    },
    inspection: () => ({ policy: "source-cue-preview", nativeBackendVerified: false, available, played, dropped,
      activeOwners: owners.size, diagnostics: diagnostics.map(item => ({ ...item })), recent: recent.map(item => ({ ...item })),
      coverage: coverage.map(item => ({ ...item, uncovered: item.uncovered.map(event => ({ ...event })) })), disposed }),
    dispose() { if (disposed) return; disposed = true; for (const player of owners) player.dispose(); },
  };
}
