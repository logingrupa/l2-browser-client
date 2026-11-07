Continue the terrain investigation from:
`C:\laragon\www\l2-browser-client\artifacts\native-parity\research\terrain-mask-native-rea\REPORT.md`

Goal: recover the native terrain's observable rendering contract, then recommend
a modern implementation. L2's renderer is evidence for appearance and behavior;
its old rendering architecture is not a requirement for Babylon.

We need two clearly separated outputs:

1. Evidence of the native terrain rendering rules.
2. A proposed efficient Babylon.js implementation preserving those rules.

Use the existing PROMINENCE-PC REA/Ghidra setup, pinned analysis copies,
resource limits and retained queries. Do not reinstall tools or repeat the
completed investigation. Preserve native files, protected l2.ini, Jump Fluid,
source assets and the browser project. No game input, injection, service
changes or production-code edits during this research.

Primary investigation, in this order:

- Resolve Engine Render's GL2Shader-dependent dispatch against the
  FD3DRenderInterface vtable and trace the selector's initialization/configuration.
- Distinguish a configured/default route from an actually observed live route.
  If static evidence cannot identify the live route, retain conditional findings
  and state the smallest missing observation. Do not expand into every renderer
  branch merely because that observation is unavailable.
- For the applicable route, establish exactly how the terrain mask becomes
  output alpha, including diffuse-alpha interaction, FirstPass, layer ordering,
  blend/depth/alpha-test states, UV transforms, sampler behavior and relevant
  precision/color-space assumptions. Resolve diffuse virtual +0x94 and the
  MODULATE second operand if that route uses them.
- If it uses shaders, recover the exact TerrainMaterial.hlsl, fallback shader
  or cached program used. Missing files alone do not establish the active path.
- Trace bUseAlpha only through verified property/native layout evidence;
  do not guess offsets by adding script field sizes.
- Investigate the format-5 precomputed-weight join only if the applicable route
  uses it. Pursue unresolved CPU sample-footprint details only where they affect
  retained layers or geometry.

Preserve the report's distinction: GetLayerAlpha's CPU classification/scalar
calculation is not established as the GPU blend weight. Do not replace ordinary
BC1 texture decoding with it. The selected equal-channel masks cannot
distinguish competing channel rules.

Then propose a Babylon WebGL2 implementation suitable for GTX 1060. Keep the
current priority: reusable raw conversion and a correct baseline first,
implementation optimization and measured gains afterward.

- Explain whether the verified terrain work could become fewer shader passes,
  cached static weights or packed textures. Native D3D classes, pass organization
  and caches need not be reproduced when the observable results are preserved.
- Preserve layer order, UVs, transparency, animation and visible results.
- Identify precision/color-space differences introduced by each alternative.
- Do not assume precomputed weights are equivalent: filtering multiplied weights
  differs from multiplying filtered masks, and native intermediate framebuffer
  rounding can affect the result. Explain these conditions explicitly.
- Count texture/sampler use for the actual nine-layer section. Check available
  WebGL2 limits before claiming it fits one pass; if no live query is available,
  label the limit unknown and give a bounded fallback. Fewer draw calls alone
  do not establish faster rendering; account for texture fetches and bandwidth.
- Separate proven equivalence from assumptions and proposed experiments.
- Estimate resource costs transparently; do not claim performance gains without
  measurements. Do not change the existing acceptance tolerances.
- Keep editable source masks/materials and stable IDs. Any proposed runtime
  derivative must be reproducible and must preserve authored Editor changes.

Deliver reproducible bounded scripts, exact input hashes, instruction anchors,
a small reference calculation/test dataset where justified, and a short
implementation recommendation. Include a table mapping each native rule to
its evidence, confidence, Babylon alternative, tradeoff and validation needed.
Unequal-channel P8 and interpolated DXT1 examples may be offline synthetic
fixtures; label them as such, not as observed native execution. Write new
evidence under:
`artifacts/native-parity/research/terrain-mask-native-rea-followup/`

If static analysis cannot resolve the active path, report the smallest exact
additional observation needed. Do not broaden into unrelated reverse
engineering, new installations, production implementation or performance tuning,
or modify the running client to obtain it. Leave unresolved questions explicit
so the conversion work can continue without guessed native behavior.
