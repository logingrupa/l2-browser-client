# Lineage2Elbera reuse audit

Date: 2026-11-07. Review status: all 22 investigations and independent refutation complete.

## Decision

Use Lineage2Elbera as a source of reusable implementations, fixtures and format
knowledge before writing another decoder. There is substantial useful work here.
The best additions are bounded components fitted into the existing pipeline.
Some upstream pipelines would discard information this client already preserves.

The upstream checkout is `C:/laragon/www/Lineage2Elbera-reference`, cloned from
[Lineage2Elbera](https://github.com/elberacasa/Lineage2Elbera) at
[`12c9656e2f053b233ec3fd87056491a6a6da8b0c`](https://github.com/elberacasa/Lineage2Elbera/tree/12c9656e2f053b233ec3fd87056491a6a6da8b0c).
This is a shallow clone with the complete current source tree checked out.
Private game files and ignored third-party binaries are not part of that tree.

The root license grants MIT rights to Elbera-authored source and documentation,
with notice retention. It expressly excludes native game content and separately
licensed dependencies. There is no general prohibition on reusing its authored
tools. A nested character-pipeline package declares ISC; preserve and resolve
that particular metadata inconsistency if redistributing that component.

## Scope and existing reuse

A separate investigator was assigned to each of the user's **22 listed entries**:
18 directories and four root files. The [tracked inventory](research/lineage2elbera/inventory.json)
contains **406 files**. Investigators grouped every area's filenames and deeply
read relevant implementations; this is not an exhaustive audit of every function.
Individual reports identify execution, inspection-only conclusions and limits.

This client already vendors ten selected reader/validation symbols from this
exact upstream revision in
[`scripts/vendor/lineage2elbera_bsp/SOURCE.json`](../scripts/vendor/lineage2elbera_bsp/SOURCE.json).
Independent checks during this audit confirmed both upstream file hashes and
the local module hash match that receipt. The five local `BspPolygonTests` pass.
Broader reuse extends an existing approach.

## Conclusions for every listed entry

“Adapt” means retain useful upstream code with a small, explicit integration
boundary. It does not mean rewrite the same algorithm. “Reference” means the
current implementation is useful evidence but has no demonstrated direct fit.

| Entry | Conclusion for this client | Detailed investigation |
| --- | --- | --- |
| `anim` | Adapt qualified NPC selector/inheritance helpers and comparison fixtures. Independently resolve bone-binding/timing disagreements; retain current sparse-key conversion. | [anim](research/lineage2elbera/anim.md) |
| `audio` | Adapt ordered skill-sound row/ambiguity checks. Keep existing original-byte conversion; upstream defaults downmix WAVs to lossy mono Opus. | [audio](research/lineage2elbera/audio.md) |
| `audit` | Adapt a source-to-runtime gap inventory. Literal/comment classifiers and upstream baselines are not provenance evidence. | [audit](research/lineage2elbera/audit.md) |
| `dat` | Adapt strict quest-journal parsing; consider exact-level skill binding compression and independent scale/hair checks. Existing local tables already overlap extensively. | [dat](research/lineage2elbera/dat.md) |
| `dev` | Reference HTTP measurement methods. Defer upstream server and database seeding scripts, which assume different infrastructure and modify game state. | [dev](research/lineage2elbera/dev.md) |
| `l2lib` | Retain existing BSP reuse; adapt bounded class-prefix/declaration/string helpers. Generic property reading would lose repeated tags and array metadata. | [l2lib](research/lineage2elbera/l2lib.md) |
| `maps` | Adapt minimap assembly when cartography is needed; independently qualify georeferencing. Keep the stronger existing 3D map readers. | [maps](research/lineage2elbera/maps.md) |
| `mesh` | Adapt armor slot/table coverage logic. Geometry export can discard additional primitives and distinct inverse-bind matrices. | [mesh](research/lineage2elbera/mesh.md) |
| `patches` | Reference macOS/ARM build changes; optionally adapt deterministic capture controls into a separately pinned comparison viewer. | [patches](research/lineage2elbera/patches.md) |
| `playtest` | Adapt injected-clock/transport regression patterns when networking is implemented. Live CLI targets a different gateway/state model. | [playtest](research/lineage2elbera/playtest.md) |
| `release` | Adapt explicit source allowlists and testing of extracted kits if distributing tooling. Keep the existing asset-archive implementation. | [release](research/lineage2elbera/release.md) |
| `src` | Adapt selected winding/material diagnostics. Character assembly changes weights, attachment and timing, conflicting with current preservation guarantees. | [src](research/lineage2elbera/src.md) |
| `ui` | Adapt bounded notify comparison fixtures and, later, native font/layout extraction. Most files are native verifiers, not ready-made interface components. | [ui](research/lineage2elbera/ui.md) |
| `upscale` | Defer AI upscaling for source-fidelity work; reference material inventory/compositing methods only. | [upscale](research/lineage2elbera/upscale.md) |
| `uscript` | Adapt bounded embedded TextBuffer extraction. It cannot replace UELib class-default decompilation or recover stripped bytecode. | [uscript](research/lineage2elbera/uscript.md) |
| `utx` | Reference the version-117 inspector if needed; defer editing. Existing local readers support relevant newer layouts and preserve original mips/blocks. | [utx](research/lineage2elbera/utx.md) |
| `world` | Strong candidate: reuse BSP render-section/lightmap parsing with export-boundary fixes and raw-data retention. Later consider collision records and terrain cross-checks. | [world](research/lineage2elbera/world.md) |
| `xdat` | Adapt native UI extraction behind source hashes and stronger boundary checks. Its span-coverage metric does not establish complete decoding. | [xdat](research/lineage2elbera/xdat.md) |
| `README.md` | Use the catalog to discover existing tools and distinguish portable, private-input and live checks; verify claims against code. | [README](research/lineage2elbera/readme.md) |
| `battery.sh` | Reference suite/exit-status contracts; retain local runners. Broad process cleanup, mutable logs and zero-suite success prevent direct adoption. | [battery.sh](research/lineage2elbera/battery-sh.md) |
| `build-tools.sh` | Reference only on Windows. Keep the existing hash-pinned UModel; upstream downloads and shared patched build state are not reproducibly pinned. | [build-tools.sh](research/lineage2elbera/build-tools.md) |
| `test_battery.js` | Reference negative runner/argument fixtures. Unix shell, CommonJS/ESM and untested cleanup/startup paths prevent direct adoption. | [test_battery.js](research/lineage2elbera/test-battery.md) |

## Recommended proofs before implementation

These are reuse opportunities, not a replacement for the current
[rendering and performance sequence](RENDERING.md).

1. **Baked BSP lighting is the strongest visible-content candidate.**
   Reuse `tools/world/lightmap.py:160` and `bsplight.py:388`, extending the existing
   package adapter with the APIs they require, including `ref_name`. Local
   `scripts/native_bsp_floor.py:309` leaves that tail undecoded. First verify a
   relevant lit node in the already-qualified UE123/licensee28 `20_20.Model798`
   and identify the visible difference being addressed. Require exact source
   spans, render-position correspondence, valid atlas membership and native UVs,
   deterministic payloads and malformed
   input refusal. The refuter found that current readers can cross export
   boundaries; returned records round floats, discard mask payloads and retain
   only mip-0 offsets. Add export-bounded reads and raw float/mask/all-mip spans,
   including validation of section metadata and zero-record cases. Preserve
   unexplained bytes and report unwalked atlas regions explicitly. Promote UV
   and polygon consistency counters to explicit validation failures; returning
   from `decode_model` alone does not establish them. Preserve every variant;
   its runtime selection remains unresolved. A separate Babylon comparison must
   establish a visible benefit.

2. **Reuse bounded reflection readers when default-property evidence is needed.**
   `tools/l2lib/classdata.py:152` and `declarations.py:141` offer explicit class
   boundaries and declarations. Retain the local tag-preservation contract for
   admitted records. Extend the adapter with names/imports, class identity and
   superclass references; validate tags against inherited declarations and
   types. Qualify one file-123 class against existing UELib authored-default
   evidence. Neither path alone proves a fully initialized default object;
   unsupported tokens and nonfinite typed values remain explicit. Do not replace
   package names, DAT strings and property strings with one unqualified rule.

3. **Compare animation/audio behavior before changing it.**
   Reuse NPC selector routines, `skill_sound_rows` and notify fixtures. Report
   differences in duplicate-name bone binding, implicit/equal key times,
   source-order notifications, null callbacks and loop boundaries. These are
   identified disagreements, not demonstrated local bugs. Qualification needs
   the actual locally pinned build and an observed behavior worth reproducing.

4. **Use existing decoders when quest and native UI features enter scope.**
   Adapt `tools/dat/export_quests.py:59`, `tools/xdat/parse_xdat.py` and selected
   UI miners. Quest parsing is bounded; XDAT needs additional framing/provenance
   checks and separately registered input. Their outputs supply data, not a
   completed interface or authoritative server quest logic. Armor/minimap
   expansion should likewise reuse table/assembly helpers without adopting
   unverified geometry or georeferencing policy.

5. **Borrow verification and distribution methods where they add coverage.**
   Reuse synthetic fixtures and isolated-source-kit testing. Keep local asset
   hashing, qualified references, original mips, deterministic receipts and
   source-preserving GLB processing. Do not create a parallel converter or test
   framework merely to mirror upstream's directory structure.

## Important objections and verification

The [independent refuter](research/lineage2elbera/refuter.md) challenged the
recommendations against actual code and reproduced a lightmap export overread
using a two-byte synthetic package. All substantive objections were accepted:
the proposed lighting adapter now requires preservation/boundary fixes,
reflection reuse requires declaration/type validation, and test/preservation
claims retain their limits. These are corrected recommendations; this audit
does not implement those upstream fixes or claim the lighting proof passed.

Several native verifiers pin Engine SHA-256
`07b24af4ab55e4230d0a7949df5b07565319e62a1b20f38fefb16ebe54821ad0`;
this client's recorded Engine.dll is
`4dd2f63c606df5671702911fa1f8ddcc4099bf2b98b81e8aa88eed47f5405b08`.
Do not remove gates or assume equivalent instruction addresses. Portable
fixtures remain useful; native-verifier success on another build would not
prove our integrated behavior. Likewise, Three.js inspectors, macOS launchers,
aCis-derived metadata and fixed source directories need explicit adapters.

Existing local preservation also has limits. Buffer/sidecar equality does not
prove native deformation: local weight recovery records unresolved source
representation selection, combines duplicate same-bone lanes for standard glTF,
and can store a quantized standard derivative alongside exact custom attributes
(`scripts/native_assets_lib/weights.py:321`). Keep those distinctions, and the
animation/notify disagreements above, visible in future acceptance results.

Executed bounded checks included:

- `l2lib`: 56 passed, plus two synthetic differential assertions.
- `world`: 66 passed for collision, identity, topology and edge fixtures;
  **these do not exercise the lightmap decoder**. An attempted static-collision
  suite could not import optional `capstone`.
- `ui` notify fixtures: 23 passed; `anim`: 18; `audio`: 14.
- Selected `dat` suites: 13 passed, four private-fixture skips.
- `uscript`: six passed; `xdat`: 17; portable `playtest`: 22.
- Extracted release kits: Core 84 passed and NPC Source 95 passed. These reuse
  some suites above and are not additional unique-coverage counts.
- BSP release check failed before Node execution because
  `tools/release/smoke_bsp.py:79` reads UTF-8 HTML with Windows cp1252 defaults.
- Local existing BSP integrity checks and five polygon tests passed.
- The refuter independently reproduced the synthetic overread and reran the
  same five `l2lib` modules: 56 passed, with no additional unique coverage claim.

Other reports explicitly mark source-only inspections. The audit did not run
the full battery, install dependencies, execute original game binaries, launch
services, modify private assets, or change application behavior. A passing
synthetic check establishes its fixture contract, not complete client parity.

## Reuse rule for subsequent work

Before adding a decoder, exporter or evidence harness, check this inventory,
the upstream implementation, and the local equivalent. Prefer pinned upstream
functions plus a small adapter when they preserve the required data. Carry the
license and source hashes, reuse relevant fixtures, add an independent acceptance
check, and document any incompatible assumption that requires a local extension.
Retain unknowns as explicit results. Legacy implementation details should justify
their cost through a required behavior or a meaningful visible difference.
