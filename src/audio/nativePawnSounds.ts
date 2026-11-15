/** Per-pawn "is this sound still playing" ledger shared by every browser
 * system that plays sounds on a pawn (direct AnimNotify_Sound cues and the
 * combat AttackItem/AttackVoice/AttackShot routes).
 *
 * Native rule (native-sound-answers-20261107 REPORT.md Q4, verify_anchors.json):
 * UAnimNotify_AttackItem::Notify 0x106bce40 and UAnimNotify_AttackVoice::Notify
 * 0x106bd860 skip their pick when ALAudio IsPlaying(pawn, sound) (vtable +0x90)
 * reports the same USound already playing on that pawn, whichever notify
 * started it. Browser identity: pawn = world entity id, sound = casefolded
 * source Sound object (Package.Group.Name). One ledger per mixer instance. */
export interface NativePawnSoundLedger {
  /** `until` is the AudioContext time the voice ends naturally; `active` (when known) is authoritative. */
  started(pawn: string, sound: string, owner: string, until: number | null, active?: () => boolean): void;
  playing(pawn: string, sound: string): boolean;
  /** Call after stopping an owner's voices (mixer.stopOwner). */
  release(owner: string): void;
}

interface Entry { readonly sound: string; readonly owner: string; readonly until: number | null; readonly active?: (() => boolean) | undefined }
type Clock = { contextTime?: () => number | null };

const ledgers = new WeakMap<object, NativePawnSoundLedger>();

export function nativePawnSoundLedger(mixer: object): NativePawnSoundLedger {
  const existing = ledgers.get(mixer);
  if (existing) return existing;
  const clock = mixer as Clock, pawns = new Map<string, Entry[]>();
  const now = () => typeof clock.contextTime === "function" ? clock.contextTime() : null;
  const alive = (entry: Entry, time: number | null) => entry.active ? entry.active() : time !== null && entry.until !== null && time < entry.until;
  const ledger: NativePawnSoundLedger = {
    started(pawn, sound, owner, until, active) {
      if (!pawn || !sound || !owner) return;
      const time = now(), rows = (pawns.get(pawn) ?? []).filter(entry => alive(entry, time));
      rows.push({ sound: sound.toLowerCase(), owner, until, active });
      pawns.set(pawn, rows);
    },
    playing(pawn, sound) {
      const rows = pawns.get(pawn);
      if (!rows?.length) return false;
      const time = now(), live = rows.filter(entry => alive(entry, time));
      if (live.length !== rows.length) pawns.set(pawn, live);
      const identity = sound.toLowerCase();
      return live.some(entry => entry.sound === identity);
    },
    release(owner) {
      for (const [pawn, rows] of pawns) {
        const kept = rows.filter(entry => entry.owner !== owner);
        if (kept.length !== rows.length) pawns.set(pawn, kept);
      }
    },
  };
  ledgers.set(mixer, ledger);
  return ledger;
}
