# Source section boundary completeness

The original `20_20` section selected static actors by their serialized origins.
That omitted five already converted trees whose indexed triangles cross the
section boundary. The additive pipeline selects those placements using actual
triangle intersection, while keeping the existing source-Z window and all
original placements. It does not clip or rescale the tree meshes.

That first correction produced **156 placements using the same 61 models**. The added
source actors are `20_20.StaticMeshActor3701`, `3978`, `3258`, `2218` and `3261`.
They use `Oren_tree_S.Elf_Colors.Oren_elf_tree03`, `08` and `09`.

The later [new-model addition](NATIVE_MAP_MODEL_APPEND.md) brings the current
section to **157 placements / 62 models** by adding Actor3703 and its Dion tree.
The commands and pins below remain the closed first correction, not the current
catalog selection; do not re-stage that older bundle over the current world.

## Repeatable local commands

Run from the project directory with the retained inputs present and Editor Play
stopped. The source directory, saved original binaries and previous bundles are
read-only inputs. Do not run a broad reconversion or reimport the authored scene
to apply this correction.

```powershell
python -B scripts/derive-native-map-overlap.py --output artifacts/native-parity/research/map-overlap-20261106/runtime
node scripts/append-native-editor-placements.mjs --manifest artifacts/native-parity/research/map-overlap-20261106/runtime/bundle/map-section-runtime/manifest.json --sha256 fdee12862293d14bb9812eb63789aa336f91ffd18473623b6debd709bfffc3dc
python -B scripts/derive-native-map-overlap.py --output artifacts/native-parity/research/map-overlap-20261106/runtime --stage
node scripts/append-native-editor-placements.mjs --manifest artifacts/native-parity/research/map-overlap-20261106/runtime/bundle/map-section-runtime/manifest.json --sha256 fdee12862293d14bb9812eb63789aa336f91ffd18473623b6debd709bfffc3dc --apply
pnpm build
```

The first two commands prepare and validate without editing public or authored
assets. Repeated staging preserves identical bytes. Repeated Editor append is a
no-op and retains later authored placement edits. Changed source identities,
geometry, conflicting outputs or unrelated catalog changes fail explicitly.
The scripts are scoped to the retained UV-corrected base bundle; they do not
silently accept a new full-migration output. A later source expansion needs its
own verified base and incremental authored migration.

`native_map_overlap.py` is also usable as a standalone read-only audit: supply
`--client`, `--raw`, `--runtime-manifest`, `--runtime-sha256`, `--class-evidence`
and optionally `--recipe`. Its default output is JSON on stdout. `--output`
exclusively creates a new scratch report.

## Selection and preservation

- Source map SHA-256:
  `1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4`.
- Original XY rectangle: `[8192,92160]..[14336,98176]`; original actor-origin Z
  window: `[-4000,-2500]`. Both are unchanged.
- All 4,183 static actor transforms/references are checked against source tags.
  Within the Z window, 151 origins are inside and 2,055 are outside the rectangle.
- Of the 261 outside-origin actors using available converted meshes, five have
  positive-area indexed triangle projections inside the rectangle; 256 do not.
  The report records the first actual clipped triangle and source hashes for
  each addition, rather than relying on overlapping bounding boxes.
- The later bounds scout screened **1,794 outside-origin actors across 193
  previously unavailable model identities**. One candidate, Actor3703, passed
  full indexed geometry inspection with eight positive-area intersections and
  is now integrated. This does not establish complete geometry/material support
  for all identities; 103 licensee12 cases retain bounds-only limitations.
  Zero-area vertical faces and edge/point-only contacts do not qualify under
  this explicit selection rule.
- Existing model/terrain bytes, all 735 corrected V values, UV2 and original
  conversion provenance remain intact. The new source bundle keeps 937 of 939
  base files unchanged; only runtime manifest/receipt change, plus a new audit.
- Editor migration appends 30 JSON records from the retained source templates,
  reusing nine verified geometry resources and current shared materials. Every
  existing placement, mesh, material and geometry file stays unchanged. Only
  the world manifest and the matching config/channel-sidecar identities change.
  Export-cache updates are generated build metadata.

Source templates supply the new placements' transforms. Existing authored
placement offsets are preserved and are not copied into newly added actors.
Shared authored material settings remain shared. This task verifies saved data,
CLI export and browser routes; it does not add a new interactive Editor save
claim. Reopen the saved scene normally to refresh an already open Editor view.

## Evidence boundaries

[The implementation report](../artifacts/native-parity/research/map-overlap-20261106/REPORT.md)
contains receipts, checks and same-camera desktop/mobile captures. This is a
source-backed completeness correction, not visible native screenshot parity,
whole-map completeness, collision parity or a performance improvement claim.

The earlier 74-file post-migration packet remains **unreviewed**; no substitute
review was requested. The subsequent 27-file source-boundary addendum passed
its own configured review only. Its target-format and one-frame parsing results
do not authorize alpha quantization or terrain composition changes. This fix
does not depend on either unresolved rendering policy. The completed UV review
and migration remain closed. Original audio, visible native composition and the
broader client acceptance remain unresolved. No native action, service change
or deployment accompanies this work.
