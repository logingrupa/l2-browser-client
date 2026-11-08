# Native world flame presentation

The `FX_E_S.Flameset.Default_Flame01` preview uses the retained source material
graph, its sixteen texture frames, glow image and twelve exact `20_20` placement
identities. It runs from the `.l2asset` catalog on the native route
(`/?world=interlude`, NOED-01). The optional authored route (`authored=1`) uses
the same presentation owner; see [EDITOR_VIEWER.md](EDITOR_VIEWER.md). Native
lighting, clock synchronization and visual parity are unverified; this is a
source-formula preview.

Status and work order: [.planning/STATE.md](../.planning/STATE.md) and
[.planning/ROADMAP.md](../.planning/ROADMAP.md). Evidence index:
[VERIFICATION.md](VERIFICATION.md). World context: [NATIVE_WORLD.md](NATIVE_WORLD.md).

## Source and ownership

The reader verifies the section archive's length and hash, model identity and
geometry hash before resolving graph classes, inherited defaults, dependencies,
image hashes and original mip slices. The 240-entry archives and the 250-entry
DXT5 archive are supported. The DXT5 archive is an unstaged migration candidate:
the public catalog is not regenerated from it. See
[NATIVE_TEXTURES.md](NATIVE_TEXTURES.md) for preserved DXT5 blocks and mips.

Each placement binds two meshes through retained material `gltf.extras` and
source placement metadata. Mesh names are not binding keys. The entire
serialized PBR surface must match the diagnostic baseline, apart from identity
fields and the audited Editor light-count default change. Meaningful material
edits preserve the whole placement. Later replacements or reparenting release
that placement without reclaiming authored assignments.

Materials use the recovered RGB blend factors: flame `ONE / ONE_MINUS_SRC_COLOR`,
glow `ONE / ONE`, with depth writes disabled and source culling retained. Glow's
zero alpha does not suppress its RGB. Seventeen verified PNGs provide mip zero
without generated mips; native filtering and color-space equality are open.

Reversible billboard wrappers preserve placement matrices, original child
transforms and geometry. Source-double and saved-float32 matrices are accepted
as exact whole representations; later ownership checks compare the accepted
matrix exactly. The browser camera supplies an explicitly identified proxy for
the native viewport actor location. It is not proven equivalent.

Effect cleanup precedes section teardown, including cancellation during startup.
Separate linked lifetimes prevent a section's abort listener from restoring
authored-route coordinates or releasing geometry before effect cleanup. Corrupt
or unsupported effect data keeps the valid world and original materials.

## Inspection

Open `/?world=interlude`. **Dev → World › Flames → Inspect flame** cycles
through the twelve placements; **Follow fighter** returns to the actor camera.
FPS stays visible.

The source route uses texture and fade starts **0 / 0** and replay rates
**1 / 1**. Editor-authored Flame replay settings and their evidence are in
[EDITOR_VIEWER.md](EDITOR_VIEWER.md).

Both browser clocks advance from the uncapped engine frame delta and pause with
the local adapter. They do not use its clamped actor simulation step. Native
texture and fade clocks come from distinct source paths whose origins and pause
relationship are unresolved. Browser inspection can pause the adapter and call
`window.__nativeSlice.setFlameReplay({ textureSeconds, fadeSeconds })` to seek
each independently. Diagnostics expose loaded resources, placement and slot
counts, clock policy, ownership releases and explicit failure state.

## Current behavior

- All twelve placements render with 24 active bindings, 17 textures and two
  shared materials.
- Paused replay switches texture frame 0 to frame 6 at 0.21 seconds, and
  changes fade without changing the frame.
- Corrupt effect data keeps the valid world and actors and shows a persistent
  status explanation.

Exact commands, screenshots and scope are in [VERIFICATION.md](VERIFICATION.md).
Evidence: `artifacts/native-parity/research/flame-runtime/`.

## Native differences

Offline evidence is under `artifacts/native-parity/research/flame-runtime/`.
The lighting follow-up decodes thirty referenced lights and traces cache
rebuilding, visibility bits and fixed-function diffuse application to both
materials. Stored black RGB is a rebuildable cache, not a valid final light
multiplier. The eight-vertex mapping audit establishes exact primitive and
index correspondence, white source color and alpha streams, and the exporter's
binary32 unit conversion. It keeps original native floats because scaling loses
one native float ULP for two vertices.

The light-evaluation audit
(`artifacts/native-parity/research/flame-runtime/lighting-followup/light-evaluation/findings.md`)
recovers ordinary steady point-light radius, intensity and color construction
for all thirty initial source lights. Its two collector runs reproduce exactly;
six algebra checks and 82 output hashes pass. The preview is unlit and must not
be described as native lighting fidelity.

No source asset repair, native lighting fit, networking completion or
performance gain is claimed by this presentation layer.

## Open

These stay unresolved:

- Live light eligibility, color branch, level scalar and environment outputs,
  caller transforms, ambient and dynamic-light inputs, and the active renderer
  path (POL-04).
- Native numerical precision at animation boundaries, clock and camera
  equivalence, fog, filtering and draw order, and matched visual evidence
  (CHECK-01, POL-04).
- Effect placement for tiles other than `20_20` (WORLD-01, ACT-06).
- Controlled performance acceptance (PERF-01).
