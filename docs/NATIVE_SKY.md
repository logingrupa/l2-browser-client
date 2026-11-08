# Original 20_20 sky snapshot

## Time and world-event research — 2026-11-07

The [follow-up research](NATIVE_SKY_TIME_EVENTS.md) identifies original preset
comments for default, Dusk, Dawn and cursed sword, plus daily T=0..24 color keys.
Historical Seven Signs notes describe Dawn's violet sky/solar eclipse and Dusk's
green sky/eye in the moon. Interlude emulator sources separately synchronize
game time, select Seven Signs sky and trigger temporary cursed-weapon red sky.
Exact native consumers, interpolation and effect restoration remain open;
ordinary lunar phases are not established. [`.todo`](../.todo) records the
implementation and remaining research tasks.

## Explicit environment-row comparison — 2026-11-07

The game now has a reversible comparison under **Dev → World › Sky → Load sky color
tables**. Choose a file and physical color row, then **Compare selected sky row**.
Loading or selecting data leaves the stored colors active. **Restore stored
sky** reinstates the original material references.

The [comparison report](../artifacts/native-parity/research/sky-literal-comparison-20261107/REPORT.md)
records implementation and current verification. The reusable
`scripts/stage-native-environment.mjs` stages exact converted tables and manifests
as immutable local browser resources, preserving all 20 tables / 500 rows and
source anomalies. The runtime verifies the table hash and matches exact source
material identities. It uses private PBR copies and changes only their RGB
factor under the existing browser convention; authored colors, alpha, textures,
blend/depth/cull state and disk assets remain intact.

This is an explicit source-data comparison, not a native time-of-day system.
`timeenv0.int` / `COLOR13` contains T=12 and background 66/124/176, haze
188/203/224 and cloud 255/255/255. It is not established as the native default.
The current default yellow appearance still needs the environment selection,
evaluated color/writer and visible-reference join. CloudColor2/3 have no drawn
counterpart in the current three-part sky. No native policy or parity is inferred
from a selected row's appearance.

## Environment source-table conversion — 2026-11-07

The [reusable offline converter](../artifacts/native-parity/research/sky-environment-conversion-20261107/REPORT.md)
now exports exact Env.int/timeenv0..3 inputs, decoded bytes, 1,681 ordered
properties and 20 sky/haze/cloud tables containing 500 physical color rows.
Eleven tests pass; clean/repeat/verify-only checks preserve identities and output.
Duplicate sections and declared-versus-physical count mismatches remain explicit.

Run `python -B scripts/export-native-environment.py --input-dir <copies> --output <fresh-dir>`;
the report supplies exact retained input/output paths. This is conversion,
not a selected runtime sky policy. Native environment/time/interpolation and
the live color writer remain unproved; authored colors are unchanged.

The latest [browser observations](../artifacts/native-parity/editor/uv2-export-20261107/browser/REPORT.md)
show all three sky meshes drawing on source/authored desktop/mobile WebGPU.
The yellow sky, cloud bands and hard blue horizon are an appearance gap, not
absent geometry in those views. A labeled source-row comparison can now use the
converted tables without silently replacing stored tints or claiming parity.

## Earlier source sky geometry checkpoint

The missing sky came from a separate final-BSP sky room that the static-mesh
map loader omitted. The source contains 53 polygons, 182 vertices, 76 triangles
and three original material/texture chains. `native_sky.py` reads the exact
hash-pinned `20_20.unr`, `Engine.u` and UE118/licensee0 `l2_skies.utx` branch.
It does not relax the generic package reader or change the BSP reader.

The [source report](../artifacts/native-parity/research/native-sky-20261106/REPORT.md)
records native identities, offsets, normals, UV projection, material graph and
original BC1/BC3 blocks. Native FColor here is RGBA, including the stored orange
background `(206,150,0,255)`. Live time-of-day tint replacement is unobserved;
this is a frozen authored source snapshot, not a matched native sky.

## Repeatable local command

From the project root in PowerShell:

```powershell
python scripts/native_sky.py --client artifacts/native-parity/inputs/IMPORTA-PC --output artifacts/native-parity/research/native-sky-20261106/source-snapshot-pinned
if ($LASTEXITCODE -eq 0) { node scripts/stage-native-sky.mjs --source artifacts/native-parity/research/native-sky-20261106/source-snapshot-pinned --apply }
if ($LASTEXITCODE -eq 0) { pnpm build }
```

The extractor reproduces 21 files exactly and skips identical outputs. The
stager checks every source hash, writes an immutable `public/l2/skies/<hash>`
bundle, and appends a separate sky root, three mesh/material records and original
PNG textures to the existing `native-world.scene`. The 32 added files do not
rewrite its world root, config, terrain proof, catalog or existing geometry.
Repeat staging preserves later authored sky edits. Remove `--apply` to inspect
the plan without changing the project.

The source manifest is
`f7a0b5ef1463d0b5fe47b210585e00d6011be3c3e3bddfec76df0eb08042f80b`.
The source route `/?world=interlude` verifies and loads its self-contained GLB.
The authored route `/?world=interlude&authored=1` uses the saved sky meshes and
materials. Authoring uses Editor 5.5.3's normal binary geometry format. The
subsequent [actual UI round trip](../artifacts/native-parity/editor/sky-save-20261106/REPORT.md)
verified cloud alpha 1 → 0.5 → 1 through UI edit, save, reopen, staging, build
and actual browser draw uniforms. The authored mobile cloud region returned
exactly to its baseline pixels. Source-loaded sky stayed unchanged. All 974
saved geometry-bearing meshes retain their original bytes; final public/dist
terrain UV2 and original geometry files are preserved. Raw Play still omits UV2.

## Coordinates and presentation

Native XYZ is converted to XZY metres. Original positions remain in vertex
buffers; one child transform subtracts SkyZoneInfo0's position. A separate
wrapper adapts the Editor's Z reflection and follows the browser camera.
The original origin is never subtracted twice. Runtime adaptations restore
authored state on teardown.

Sky draws before world geometry without writing depth. Existing world render
groups are temporarily separated and restored on disposal; sky is not included
in world navigation or map bounds. Fog is disabled only for sky materials. These
are explicit browser background policies, not reconstructed native draw rules.
Babylon's ordinary unlit glTF color/alpha and trilinear GPU mip sampling are used
consistently on both routes. Original compressed mip blocks remain retained.

Native sky projection, fake-backdrop masking, blend/sidedness precedence,
color-space behavior, time-of-day changes, cloud phase, sun/moon and lens flares
remain unresolved. The [precise research question](../artifacts/native-parity/research/native-sky-20261106/RESEARCH_QUESTION.md)
identifies the missing observations. No native launch or capture was performed.
Source extraction and browser visibility cannot certify native pixel parity.

## Opacity and actual draw checkpoint — 2026-11-06

The [static opacity audit](../artifacts/native-parity/research/native-sky-20261106/opacity-audit/REPORT.md)
and [live browser observation](../artifacts/native-parity/research/native-sky-20261106/live-opacity/2026-11-06T16-13-25-773Z/REPORT.md)
establish that original texture alpha survives and participates in the draws on
both source and authored routes, desktop and mobile. WhiteRing alpha spans
0–255 and WhiteCloud 0–208. Active shaders multiply sampled albedo alpha, and
the bound GPU textures retain those alpha histograms. A separate opacityTexture
is unnecessary for this particular Babylon representation.

Observed sky order is background, haze, clouds, then depth/stencil clear before
the world. Haze/cloud RGB blending uses SRC_ALPHA / ONE_MINUS_SRC_ALPHA with
FUNC_ADD; alpha-channel factors are ONE / ONE. Sky depth testing is LEQUAL,
depth writes are disabled and culling is BACK/CCW. These are measured browser
states, not reconstructed native blend rules. All four views were ready, with
zero page/GL errors and unchanged terrain primary UV/UV2 hashes.

No missing-opacity or tint repair follows from this checkpoint. The hard
yellow/blue boundary remains unresolved. The retained native
[sky note](../artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/sky-assist-20261106/REPORT.md)
needs a positive runtime color writer joined to exports 76/77/78, with conditions,
time source and evaluated values, plus a selected native sky draw/resource join
for color/alpha operations, blend/depth/cull state and order. Saved root alpha
255 alone does not establish opaque sampled layers. No gradient, recoloring,
guessed time-of-day policy or duplicate opacity binding was introduced.
