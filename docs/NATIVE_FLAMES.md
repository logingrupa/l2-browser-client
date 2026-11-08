# Native world flame presentation

The `FX_E_S.Flameset.Default_Flame01` preview uses the retained source material
graph, its sixteen texture frames, glow image and twelve exact `20_20` placement
identities. It runs through the same presentation owner on source and saved
Editor world routes. Native lighting, clock synchronization and visual parity
remain unverified; this is a source-formula preview.

## Source and ownership

The reader verifies the section archive's length/hash, model identity and
geometry hash before resolving graph classes, inherited defaults, dependencies,
image hashes and original mip slices. Existing 240-entry archives and the new
250-entry DXT5 archive are supported. The latter remains an unstaged migration
candidate: the existing public catalog and saved scene are not regenerated.
See [NATIVE_TEXTURES.md](NATIVE_TEXTURES.md) for preserved DXT5 blocks/mips.

Each placement binds two meshes through retained material `gltf.extras` and
source placement metadata. Mesh names are not binding keys. The entire
serialized PBR surface must match the diagnostic baseline, apart from identity
fields and the independently audited Editor light-count default change.
Meaningful material edits preserve the whole placement. Later replacements or
reparenting release that placement without reclaiming authored assignments.

Materials use the recovered RGB blend factors: flame `ONE / ONE_MINUS_SRC_COLOR`,
glow `ONE / ONE`, with depth writes disabled and source culling retained. Glow's
zero alpha does not suppress its RGB. Seventeen verified PNGs provide mip zero
without generated mips; native filtering and color-space equality remain open.

Reversible billboard wrappers preserve placement matrices, original child
transforms and geometry. Source-double and saved-float32 matrices are accepted
as exact whole representations; later ownership checks compare the accepted
matrix exactly. The current browser camera supplies an explicitly identified
proxy for the native viewport actor location. It is not proven equivalent.

Effect cleanup precedes section teardown, including cancellation during startup.
Separate linked lifetimes prevent a section's earlier abort listener from
restoring Editor coordinates or releasing geometry before effect cleanup.
Corrupt or unsupported effect data retains the valid world and original materials.

## Inspection and authoring

Open `/?world=interlude` or `/?world=interlude&authored=1`. **Dev → World ›
Flames → Inspect flame** cycles through the twelve placements; **Follow fighter** returns
to the actor camera. FPS remains visible.

The attached `NativeParityScript` declares a **Flame replay** group: enable,
independent texture/fade start seconds, and independent replay rates. These are
authored settings; migration does not write them. Actual Editor 5.5.3 UI
edit/save, generation/build, reopening and Play are now verified. In
`native-world.scene`, preview remains enabled with texture/fade starts
**0.25 / 0.75 seconds** and replay rates **0.5 / 1.5** as a labeled authored
demonstration. The ordinary source-world route retains starts **0 / 0** and
rates **1 / 1**. Select **Scene → Inspector → Scripts → scripts/nativeParity.ts
→ Flame replay** to inspect these fields.

The save preserved source placement metadata, all 414 materials, 193 PNGs and
the other geometry channels. It repeated the known terrain UV2 loss and removed
the thumbnail; prepack restored the exact UV2 channel and original recovered
binary before reopening. All **2,244 files / 53,057,535 bytes** in that recovered
baseline survived actual reopen/Play/Stop, final browser checks and repeat import
unchanged. The removed thumbnail remains in the pre-save backup.
[The Editor record](EDITOR_ROUNDTRIP.md) links
typed/reopened values and the actual visible flame/glow captures. Full skill
effect authoring and Power Strike timing remain separate open work.

Both browser clocks advance from the uncapped engine frame delta and pause with
the local adapter. They do not use its clamped actor simulation step. Native
texture and fade clocks come from distinct source paths whose origins and pause
relationship are unresolved. Browser inspection can pause the adapter and call
`window.__nativeSlice.setFlameReplay({ textureSeconds, fadeSeconds })` to seek
each independently. Diagnostics expose loaded resources, placement/slot counts,
clock policy, ownership releases and explicit failure state.

## Native differences still open

Offline evidence is under `artifacts/native-parity/research/flame-runtime/`.
The lighting follow-up decodes thirty referenced lights and traces cache
rebuilding, visibility bits and fixed-function diffuse application to both
materials. Stored black RGB is a rebuildable cache, not a valid final light
multiplier. The subsequent eight-vertex mapping audit establishes exact
primitive/index correspondence, white source color/alpha streams, and the
exporter's binary32 unit conversion. It retains original native floats because
scaling loses one native float ULP for two vertices. A further
[light-evaluation audit](../artifacts/native-parity/research/flame-runtime/lighting-followup/light-evaluation/findings.md)
recovers ordinary steady point-light radius, intensity and color construction
for all thirty initial source lights. Its two collector runs reproduce exactly;
six algebra checks and 82 output hashes pass. Live eligibility, color branch,
level scalar/environment outputs, caller transforms, ambient/dynamic-light
inputs and the active renderer path remain unresolved.
The current unlit preview must not be described as native lighting fidelity.

Native numerical precision at animation boundaries, clock/camera equivalence,
fog/filtering/draw order and matched visual evidence also remain open. No source
asset repair, native lighting fit, networking completion or performance gain is
claimed by this presentation layer.

## Verification checkpoint

The latest authored checkpoint passes **435 unit tests / 39 files** and
**6/6 rebuilt browser cases** in 5.3 minutes: source/authored flame desktop,
authored flame mobile, corrupt-flame fallback, and authored world desktop/mobile.
Generation, typecheck and build pass. Evidence is under
`artifacts/native-parity/editor/flame-authoring/`; native visual parity and
controlled performance acceptance remain open.

The preceding runtime checkpoint passed 433 unit tests and all nine selected
browser cases across the recorded runs. Source/authored desktop and authored mobile
render all twelve placements with 24 active bindings, 17 textures and two shared
materials. Paused replay independently switches texture frame 0 to frame 6 at
0.21 seconds and changes fade without changing the frame. Corrupt effect data
retains the valid world and actors and leaves a persistent explanation in Demo
controls. At that checkpoint all 2,245 authored files remained unchanged.
Exact commands, intermediate failures, screenshots and remaining scope are in
[VERIFICATION.md](VERIFICATION.md).
