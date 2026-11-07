# Independent refutation

Reviewed the main audit and all 22 completed entry reports, including
`test-battery.md`, against selected upstream and local implementations. Upstream
HEAD independently resolves to `12c9656e2f053b233ec3fd87056491a6a6da8b0c`.
This is a bounded challenge of the highest-impact recommendations, not another
complete function audit. Findings below concern the draft examined; the parent
investigator was notified and may already have incorporated corrections.

## High: the proposed lightmap decoder needs preservation and boundary changes

The reuse opportunity is real, but “validates/decodes” overstates the contract of
the callable functions. `tools/world/bsplight.py:391` constructs its reader over
the whole package, without the Model export end. Its zero-record return at
`:396` bypasses the final cursor check. I reproduced an accepted overread using
only synthetic bytes: package data `00 00`, a Model export at offset zero with
length one, `lightmap_tail=1`, and empty nodes/surfaces. `decode_model` reads the
section count inside the export, then reads the zero lightmap count from the
following byte and returns success. No private data or malformed native file
was needed. `_section_vertex_offsets` and UV reads similarly need explicit
section and node vertex-range validation (`:671`, `:630`).

The returned representation also loses evidence. Mask bytes are consumed and
discarded at `:465`; the 25 floats are rounded to six decimals at `:497`; page
records retain only mip-zero offsets at `:556`. Keeping `_pkg` in memory makes
recovery possible, but the emitted JSON/PNG products do not preserve those
records. `lightmap.py:232` returns a polygon-count discrepancy rather than
rejecting it; `bsplight.py:639` counts invalid UV membership, with rejection
deferred to the CLI checker at `:772`. Reusing `decode_model` alone omits that
validation. Its zero-record case intentionally leaves unreferenced atlas data
unwalked, which must remain an explicit coverage result.

**Correction:** retain the algorithms, but specify export-bounded reads,
node/section/surface correspondence, promoted structural checks, raw float bits,
mask spans, and both mip spans for every variant. Preserve unexplained bytes
and report unwalked regions. The existing local `PackageAdapter` lacks the
`ref_name` method required by `lightmap.py:211`, so even the first call needs an
API extension (`scripts/native_bsp_floor.py:73`). This is a concrete adaptation,
not an already compatible parser import. Variant selection and Babylon light
composition remain separate appearance questions.

## Medium: the executed world tests do not qualify this leading candidate

The reported 66 successful world tests cover collision, prop identity, topology
and edges. The tracked world inventory has no dedicated lightmap test file, and
the report explicitly did not run the proposed lighting proof. These tests
therefore provide no direct regression coverage for the newly reproduced
boundary defect. Similarly, upstream measured tile counts in decoder comments
were not reproduced on the local source.

**Correction:** annotate the aggregate result as excluding lightmap decoding.
Before implementation, prove a supported lit node exists in the chosen local
slice, then exercise the decoder on that pinned Model plus malformed export,
section, index and UV cases. Treat “strongest visible-content candidate” as a
testable opportunity, not a demonstrated visual improvement or an override of
`docs/RENDERING.md`'s measurement/instancing/streaming priorities. A modern
WebGPU comparison should establish whether this work changes visible content
enough to justify its integration cost.

## Medium: class boundaries do not yet supply class-default semantics

The class recommendation correctly avoids replacing UELib immediately, but its
acceptance needs one additional distinction. Upstream
`tools/l2lib/classdata.py:152` explicitly requires validation of default tags
against declared property types. Local `Package.properties`
(`scripts/native_catalog/ue2.py:162`) preserves ordered tags and raw payloads,
but interprets their tag kinds without joining the class declaration chain. It
also rejects nonfinite typed floats. Thus “lossless tag reader” describes the
retained supported records, not universal admission or validated defaults.

The current BSP adapter has no imports/names collections, `class_name_of`,
`import_name`, or export `super_index`; those are required by class-prefix and
qualified declaration readers (`classdata.py:35`, `:42`, `:162`, `:171`).
**Correction:** define that adapter closure and declaration/type validation,
including inherited field identity and unsupported tokens. Existing
`read_class_defaults` explicitly returns authored defaults without implicit or
inherited values (`scripts/native_catalog/effects.py:264`); comparing against it
must not silently promote a serialized prefix into a loaded default object.
Reuse remains valuable for exact offsets and declaration evidence.

## Medium: preservation claims need their existing qualifications retained

Local merging really preserves original buffers and separate skins
(`scripts/native_assets_lib/gltf.py:149`), supporting rejection of upstream armor
primitive stripping. But original-buffer equality is not equivalent to native
deformation. The local weight restoration itself records unverified selection
between redundant source representations, combines duplicate same-bone slots
for standard glTF, and may retain a quantized standard derivative while storing
exact custom attributes (`scripts/native_assets_lib/weights.py:321`).

Likewise the animation disagreement is substantive: local parent/name binding
and duplicate-name correction (`animation.py:44`) differ from upstream's first
matching interned-name linkage (`tools/anim/export_source_tracks.py:108`).
Neither source-byte preservation nor passed synthetic fixtures resolves which
poses match the locally pinned client. The notify comparison is correctly
qualified: local `nativeEventAudio.ts:8` deliberately sorts preview events and
limits catch-up, whereas upstream's helper preserves serialized ordering and
restricts callback mutation. **Correction:** preserve these explicit limits in
the summary; do not frame all local conversion policy as established native
semantics or turn legacy arithmetic differences into required work without an
observable behavior or rule benefit.

## Accepted recommendations and checks performed

I accept bounded quest decoding, qualified NPC selectors, ordered sound-row
comparisons, and later XDAT/minimap extraction; these fill identifiable gaps
without duplicating the existing converters. I accept retaining local asset
packaging and Windows UModel, deferring AI upscaling, and rejecting wholesale
shell-runner adoption. `test_battery.js` actually hardcodes `/bin/bash` and
stubs port/process cleanup; its portable assertion ideas do not establish
Windows execution or full runner isolation. MIT reuse is permitted by the root
license; the nested ISC package metadata is real and should accompany copied
components, without inventing a general legal blocker.

Executed independently: source reads/searches, upstream commit check, the
in-memory lightmap overread assertion, and the stated five l2lib unittest
modules: **56 passed**, confirming that reported count. Other investigators'
test totals were not independently rerun and are not new coverage here. No
native verifier/binary, private input, service, installation, full battery or
implementation change was executed. Only this report was written.
