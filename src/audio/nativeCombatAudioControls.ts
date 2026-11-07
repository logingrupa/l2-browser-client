import { summarizeNativeCombatDispatch, type NativeCombatAudio, type NativeCombatDescription, type NativeCombatDistanceGain,
  type NativeCombatTargetRule, type NativeCombatTestScenario, type NativeCombatWeaponChoice } from "./nativeCombatAudio";

/** One hover-card the host (developer sheet) attaches to a control row. */
export interface NativeCombatControlCard { readonly element: HTMLElement; readonly title: string; readonly description?: string; readonly names: readonly string[] }

interface ChipGroup<T extends string> { readonly element: HTMLElement; set(value: T): void; setDisabled(value: boolean): void }

/** Small choice (≤4 options) as a radio chip group; the sheet styles `.dev-chips`. */
function chipGroup<T extends string>(label: string, testId: string, options: readonly { value: T; label: string }[], current: T,
  onChange: (value: T) => void, signal: AbortSignal): ChipGroup<T> {
  const group = document.createElement("div");
  group.className = "dev-chips"; group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", label); group.dataset.testid = testId;
  let value = current, disabled = false;
  const buttons = options.map(option => {
    const button = document.createElement("button");
    button.type = "button"; button.setAttribute("role", "radio"); button.dataset.value = option.value; button.textContent = option.label;
    button.addEventListener("click", () => choose(option.value, false), { signal });
    button.addEventListener("keydown", event => {
      const key = (event as KeyboardEvent).key, index = options.findIndex(item => item.value === value);
      const next = key === "ArrowRight" || key === "ArrowDown" ? (index + 1) % options.length : key === "ArrowLeft" || key === "ArrowUp" ?
        (index - 1 + options.length) % options.length : key === "Home" ? 0 : key === "End" ? options.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); choose(options[next]!.value, true);
    }, { signal });
    group.append(button);
    return button;
  });
  const render = () => buttons.forEach(button => {
    const checked = button.dataset.value === value;
    button.setAttribute("aria-checked", String(checked)); button.tabIndex = checked ? 0 : -1; button.disabled = disabled;
  });
  function choose(next: T, focus: boolean) {
    if (disabled || next === value) return;
    value = next; render(); onChange(next);
    if (focus) buttons.find(button => button.dataset.value === next)?.focus?.();
  }
  render();
  return { element: group, set(next) { if (next !== value) { value = next; render(); } }, setDisabled(next) { disabled = next; render(); } };
}

function row(label: string, ...controls: HTMLElement[]): HTMLElement {
  const element = document.createElement("div"), text = document.createElement("span"), body = document.createElement("div");
  element.className = "dev-row"; text.className = "dev-row-label"; text.textContent = label; body.className = "dev-row-control";
  body.append(...controls); element.append(text, body);
  return element;
}

/** Compact combat hit-sound controls. Explanations live in hover-cards (cards()/describe()), not inline. */
export function attachNativeCombatAudioControls(host: HTMLElement, combat: NativeCombatAudio | null, failure: string | null,
  unlock?: () => Promise<void>) {
  const lifetime = new AbortController(), signal = lifetime.signal, root = document.createElement("div");
  root.dataset.testid = "native-combat-audio-controls";
  const rows = combat?.describe() ?? [], state = combat?.inspection() ?? null;
  const available = !!combat && !!state?.bundle && !failure;
  const enabled = chipGroup("Hit sounds", "native-combat-enabled", [{ value: "on", label: "On" }, { value: "off", label: "Off" }],
    state?.enabled === false ? "off" : "on", value => { combat?.setEnabled(value === "on"); update(); }, signal);
  const rule = chipGroup<NativeCombatTargetRule>("Hit target rule", "native-combat-target-rule",
    [{ value: "selected-or-nearest", label: "Selected, else nearest" }, { value: "selected", label: "Selected only" }],
    state?.targetRule ?? "selected-or-nearest", value => { combat?.setTargetRule(value); update(); }, signal);
  const reach = document.createElement("input"); reach.type = "range"; reach.min = "0.2"; reach.max = "5"; reach.step = "0.1";
  reach.dataset.testid = "native-combat-reach"; reach.setAttribute("aria-label", "Hit reach in metres"); reach.value = String(state?.reachMetres ?? 1.5);
  const reachValue = document.createElement("output"); reachValue.className = "dev-readout"; reachValue.dataset.testid = "native-combat-reach-value";
  reach.addEventListener("input", () => { combat?.setReach(Number(reach.value)); update(); }, { signal });
  const weapons = state?.weapons.length ? state.weapons : [{ value: "fist" as NativeCombatWeaponChoice, label: "Empty hand (fist)" }];
  const weapon = chipGroup<NativeCombatWeaponChoice>("Right hand", "native-combat-weapon", weapons, state?.weapon ?? "fist",
    value => { combat?.setWeapon(value); update(); }, signal);
  const distance = chipGroup<NativeCombatDistanceGain>("Distance gain", "native-combat-distance",
    [{ value: "ambient-curve", label: "Ambient curve" }, { value: "flat", label: "Flat" }], state?.distanceGain ?? "ambient-curve",
    value => { combat?.setDistanceGain(value); update(); }, signal);
  const tests = document.createElement("div"); tests.className = "secondary-actions"; tests.dataset.testid = "native-combat-tests";
  const testButton = (text: string, scenario: NativeCombatTestScenario, testid: string) => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = text; button.dataset.testid = testid;
    button.setAttribute("data-dev-search", "Plays one complete impact now; ignores reach, selection and probabilities");
    button.addEventListener("click", () => {
      // unlock() resumes the context synchronously inside this trusted gesture.
      const ready = unlock?.() ?? Promise.resolve();
      void ready.catch(() => undefined).then(() => { combat?.test(scenario); update(); });
    }, { signal });
    tests.append(button); return button;
  };
  const testButtons = [testButton("Test fighter hit", "player-hit", "native-combat-test-player"),
    testButton("Test Musveren hit", "musveren-hit", "native-combat-test-musveren"),
    testButton("Test Power Strike impact", "power-strike", "native-combat-test-power-strike")];
  const lastAttack = document.createElement("output"); lastAttack.className = "dev-readout"; lastAttack.dataset.testid = "native-combat-last-attack";
  const last = document.createElement("output"); last.className = "dev-readout"; last.dataset.testid = "native-combat-last-hit"; last.setAttribute("role", "status");
  const status = document.createElement("p"); status.dataset.testid = "native-combat-status";
  status.textContent = failure ? `Hit sounds unavailable: ${failure}` : !combat || !state?.bundle ? "Combat hit sounds have not been staged." :
    "Native Q4 routes: AttackItem and AttackVoice at the attacker (hit or miss), AttackShot defense then damage at the target. Offline, a shot at a target is treated as a normal hit (flags 0). Target rule, reach and distance gain are presentation choices.";
  const line = {
    enabled: row("Hit sounds", enabled.element), rule: row("Target", rule.element), reach: row("Reach", reach, reachValue),
    weapon: row("Right hand", weapon.element), distance: row("Distance gain", distance.element),
    lastAttack: row("Last event", lastAttack), lastHit: row("Last hit", last),
  };
  for (const group of [enabled, rule, weapon, distance]) group.setDisabled(!available);
  for (const control of [reach, ...testButtons]) control.disabled = !available;
  // The explanation moves into the Hit sounds hover-card; only a failure stays visible.
  status.hidden = available;
  root.append(line.enabled, line.rule, line.reach, line.weapon, line.distance, tests, line.lastAttack, line.lastHit, status);
  host.append(root);
  let disposed = false, shownHit = -1, shownAttack = -1, shownReach = -1;
  // Called every frame: read the allocation-free readout and touch the DOM only on change.
  function update() {
    if (disposed || !combat) return;
    const current = combat.readout();
    if (current.reachMetres !== shownReach) { shownReach = current.reachMetres; reachValue.textContent = `${current.reachMetres.toFixed(1)} m`; }
    const attack = current.lastAttack?.sequence ?? 0, hit = current.lastHit?.sequence ?? 0;
    if (attack !== shownAttack) { shownAttack = attack; lastAttack.textContent = summarizeNativeCombatDispatch(current.lastAttack); }
    if (hit !== shownHit) { shownHit = hit; last.textContent = summarizeNativeCombatDispatch(current.lastHit); }
  }
  update();
  const cards: NativeCombatControlCard[] = [
    { element: line.enabled, title: "Hit sounds", description: status.textContent,
      names: ["combat.hitSounds", "combat.attackItem", "combat.attackVoice", "combat.defenseSound", "combat.damageSound"] },
    { element: line.rule, title: "Target rule", names: ["combat.targetRule"] },
    { element: line.reach, title: "Reach", names: ["combat.reachMetres"] },
    { element: line.weapon, title: "Right hand", names: ["combat.rightHand", "combat.attackItem"] },
    { element: line.distance, title: "Distance gain", names: ["combat.distanceGain"] },
    { element: tests, title: "Test impacts", description: "Each button plays one complete impact now: the attacker's AttackItem sound, then the target's defense and damage sounds (all probabilities forced on). Reach and selection are ignored.",
      names: ["combat.attackOutcome", "combat.powerStrikeSounds"] },
    { element: line.lastAttack, title: "Last attack event", names: ["combat.lastAttack", "combat.isPlayingSkip", "combat.slotSelection"] },
    { element: line.lastHit, title: "Last hit", names: ["combat.lastHit", "combat.attackOutcome", "combat.defenseSound", "combat.damageSound"] },
  ];
  return {
    update,
    describe: (): readonly NativeCombatDescription[] => rows,
    cards: (): readonly NativeCombatControlCard[] => cards,
    dispose() { if (disposed) return; disposed = true; lifetime.abort(); root.remove(); },
  };
}
