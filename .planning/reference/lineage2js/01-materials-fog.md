# UE2 materials and fog

> Reference notes, not decisions. `.planning/PROJECT.md` and `.planning/REQUIREMENTS.md` win where they differ. IDs marked "(proposed)" belong to `plan/autonomous-roadmap` and are not in force until that branch adopts them. Constants with status `unconfirmed` come from C4 binaries and only become native rules after they are re-derived against Interlude. The clean-room, no-vendor and shared-module rules are in [README.md](README.md).

These are reference notes, not decisions. `.planning/PROJECT.md` and `.planning/REQUIREMENTS.md` win over them. The area covers how Lineage II turns a UE2 material graph into pixels, lit by hourly lightmaps, vertex light bits, actor lights and the Env.int time-of-day tables, then fogged and gamma-ramped. Lineage2JS runs the chain in a browser and is the behavioural reference. It lacks TexScaler and MaterialSequence, which Interlude packages use, plus FB_Add, two Combiner colour operations, three alpha operations and UV channels above 1. We build a source-preserving converter, a Babylon-free model library, a thin Babylon WebGPU binding and a swatch route. Phase 2 runs reference values as unconfirmed defaults, and POL-04 re-derives them against Interlude Engine.dll 4dd2f63c... and D3DDrv.dll 05622dde..., read and never run.

## Where it fits

- Requirements: MAT-01 (proposed), MAT-02 (proposed), `ARCH-01`, `ARCH-02`, `ARCH-03`, `ARCH-04`, `CONV-02`, `WORLD-01`, `WORLD-02`, `WORLD-03`, `WORLD-04`, WORLD-07 (plan/autonomous-roadmap ID, absent on native-world-slice), `CHECK-01`, `CHECK-03`, `CHECK-04`, `POL-01`, `POL-04`, `PERF-02`
- Phase: Phase 2 holds MAT-01 (steps 1 to 9 and 13) and MAT-02 (steps 10 to 12), BSP lightmaps included. No Phase 2 step needs static binary reading. Phase 3 holds the CHECK-01 captures, CHECK-03 verdicts and CHECK-04 fixes. Phase 5 (POL-04) re-derives every unconfirmed constant against Interlude binaries.
- Lane: Integration owns `src/materials/ue2/**`, `src/shared/**`, the material converter, class defaults, census, swatch route, transparent comparator and environment record, and merges first. World owns the environment program, zone table, lighting step, camera-environment record and the BSP, static mesh, terrain, sky and flame binding. Actors own skeletal and emitter binding. Data-ui code is only imported.

Owned paths:

- `integration: src/materials/ue2/** (new)`
- `integration: src/shared/** (new, shared by the five areas)`
- `integration: scripts/native_assets_lib/material_graph.py, material_program.py (new), class_defaults.py (new)`
- `integration: scripts/audit-material-census.py (new), scripts/native_assets.py`
- `integration: src/runtime/materialSwatch.ts (new), clock wiring and the transparent comparator in src/runtime/**`
- `integration: src/world/worldTypes.ts (environment record, contract commit)`
- `integration: scripts/stage-native-environment.mjs, scripts/stage-native-sky.mjs, src/scene/loadEnvironment.ts (staging new outputs)`
- `world: scripts/native_environment.py, scripts/export-native-environment.py`
- `world: scripts/world/lighting_step.py (new), scripts/world/level_zones.py (new), scripts/world/sky_materials.py (planned by 02-45), recipes/world/**`
- `world: scripts/native_bsp_building.py, scripts/native_bsp_floor.py, scripts/native_map_geometry.py`
- `world: src/scene/world/nativeWorldMaterials.ts (new), cameraEnvironment.ts (new), nativeEnvironmentTables.ts, nativeFlameMaterials.ts, nativeMaterialGraph.ts, nativeTerrainPreview.ts`
- `actors: src/effects/** including nativeEffectMaterial.ts`
- `data-ui: scripts/native_catalog/** imported read-only`
- `shared tests: tests/unit/ue2*.test.ts, tests/unit/importBoundaries.materials.test.ts, tests/pipeline/test_native_material_program.py, tests/browser/ue2Swatch.spec.ts, tests/fixtures/ue2-materials/**`

## What the reference shows

| Topic | Where | What it shows |
|---|---|---|
| Material classes and blend decode | `lineage2js/src/assets/unreal/un-material.ts:150-260`, `lineage2js/src/assets/unreal/un-material.ts:296-430`, `lineage2js/src/assets/unreal/un-material.ts:432-547`, `lineage2js/src/assets/unreal/un-material.ts:549-819` | Fields, enums, blend switches, Combiner op gaps, TexPanner rate. |
| Decode tree | `lineage2js/src/assets/decoders/material-decoder.ts:227-246`, `lineage2js/src/assets/decoders/material-decoder.ts:400-542`, `lineage2js/src/assets/decoders/material-decoder.ts:565-662` | Modifier stages, bare Texture and root Combiner, stand-ins. |
| Uber material state | `lineage2js/src/materials/mesh-static-material/mesh-static-material.ts:13-17`, `lineage2js/src/materials/mesh-static-material/mesh-static-material.ts:144-238`, `lineage2js/src/materials/mesh-static-material/mesh-static-material.ts:310-403` | Fog families, alpha test, factor pairs, lightmap slot, light counts. |
| Shader stages | `lineage2js/src/materials/mesh-static-material/shader/shader-mesh-static.fs:542-558`, `lineage2js/src/materials/mesh-static-material/shader/shader-mesh-static.fs:599-838`, `lineage2js/src/materials/mesh-static-material/shader/shader-mesh-static.vs:407-514`, `lineage2js/src/materials/mesh-static-material/shader/shader-mesh-static.vs:715-796`, `lineage2js/src/materials/mesh-static-material/transform-stage.ts:3-4` | Fragment order, UV modifiers, env maps, halved hardware lights. |
| Lights | `lineage2js/src/materials/shader-chunks/actor_light.glsl:1-83`, `lineage2js/src/objects/dynamic-light.ts:19-106`, `lineage2js/src/objects/dynamic-light.ts:199-473`, `lineage2js/src/rendering/vertex-lighting.ts:13-29`, `lineage2js/src/objects/lit-actor.ts:177-569` | Falloffs, D3D fit, HSV plane, LightType, score, sun, vertex bake. |
| Time of day | `lineage2js/src/assets/unreal/conf-files/un-conf-env.ts:150-330`, `lineage2js/src/rendering/env-color.ts:1-82`, `lineage2js/src/rendering/l2-env.ts:81-411` | Env.int sections, row and HSV interpolation, slots. |
| Fog | `lineage2js/src/materials/shader-chunks/l2_fog_fragment.glsl:1-18`, `lineage2js/src/rendering/l2-env.ts:15-79`, `lineage2js/src/rendering/l2-env.ts:413-589`, `lineage2js/src/rendering/render-manager.ts:2017-2321` | Factor, targets, cross-fade, FogInfo hours, source order. |
| BSP sections and lightmaps | `lineage2js/src/assets/unreal/model/un-model.ts:476-594`, `lineage2js/src/assets/unreal/model/un-multilightmap-texture.ts:9-80`, `lineage2js/src/objects/zone-object.ts:767-794`, `lineage2js/src/objects/zone-object.ts:1494-1556` | Section key, UVs, hourly lightmaps, outdoor test, ambient cases. |
| Terrain | `lineage2js/src/materials/mesh-terrain-material/mesh-terrain-material.ts:60-131`, `lineage2js/src/materials/mesh-terrain-material/shader/shader-mesh-terrain.fs:31-93`, `lineage2js/src/assets/unreal/un-terrain-sector.ts:242-446`, `lineage2js/src/assets/unreal/un-terrain-info.ts:525-592`, `lineage2js/src/objects/terrain.ts:135-391` | Layer and mask UVs, blend, passes, shadow-map lerp. |
| Particles, gamma, config | `lineage2js/src/materials/particle-material/particle-material.ts:145-201`, `lineage2js/src/assets/unreal/emitters/un-particle-emitter.ts:871-889`, `lineage2js/src/rendering/display-gamma.ts:5-57`, `lineage2js/src/assets/unreal/conf-files/un-conf-system.ts:40-69`, `lineage2js/src/assets/unreal/conf-files/un-conf-system.ts:232-240` | PTDS pairs and fog, gamma ramp, defaults, ini order. |
| Clock and colour sources | `lineage2js/src/network/game-packets.ts:63,69-70`, `lineage2js/src/network/network-session.ts:22,284-285`, `lineage2js/src/network/network-manager.ts:985-986`, `lineage2js/src/rendering/render-manager.ts:2396-2404`, `lineage2js/src/assets/unreal/un-color.ts:37-43`, `lineage2js/src/materials/global-uniforms.ts:3-21` | Hour sources, advance rate, colour byte read, globals. |
| Procedural textures (later) | `lineage2js/src/materials/wet-water-texture.ts:3-60`, `lineage2js/src/assets/unreal/un-package.ts:439` | WetTexture automaton only. |

## Behaviour to implement

### Material graph walk

Each draw slot starts at a root: a static mesh slot, BSP surface, terrain layer, skeletal slot, emitter texture or sky surface. The walk runs from the outer node inward and collects state.

- FinalBlend sets FrameBufferBlending, TwoSided, AlphaTest, AlphaRef, ZWrite and ZTest. Its blend and ZWrite replace the inner Shader's.
- ColorModifier multiplies colour by Color. With AlphaBlend its alpha becomes opacity. RenderTwoSided turns culling off.
- Every TexModifier has TexCoordSource, a UV channel or a generated coordinate. TexPanner, TexRotator, TexOscillator and TexScaler give a time-dependent 3x3 UV matrix. TexEnvMap gives a reflection vector.
- Shader has Diffuse, Opacity, Specular, SpecularityMask, SelfIllumination, SelfIlluminationMask, Detail, DetailScale, OutputBlending, TwoSided, ZWrite, AlphaTest and AlphaRef.
- Combiner has Material1, Material2, Mask, CombineOperation, AlphaOperation, InvertMask, Modulate2X and Modulate4X.
- FadeColor and ConstantColor give colours. MaterialSequence picks a child over time.
- Texture is the leaf, with AnimNext, UClampMode, VClampMode, bMasked, bAlphaTexture and bTwoSided.

A bare Texture root draws opaque. bMasked alpha-tests at 127/255, and bAlphaTexture blends `SRCALPHA, INVSRCALPHA`. Nested Shaders and Combiners stay full nodes. A cycle or a graph over 128 nodes (`scripts/native_assets_lib/material_graph.py:13`) fails conversion. An unreviewed class renders magenta with `material-class-unported:<class>`.

### Blend table and fog family

Pairs are source, destination.

| Ordinal | FinalBlend | Shader OutputBlending | Particle DrawStyle |
|---|---|---|---|
| 0 | Overwrite `ONE, ZERO` | Normal `ONE, ZERO`, or `SRCALPHA, INVSRCALPHA` with Opacity | Regular `ONE, ZERO` |
| 1 | Modulate `DESTCOLOR, SRCCOLOR` | Masked `ONE, ZERO` plus alpha test | AlphaBlend `SRCALPHA, INVSRCALPHA` |
| 2 | AlphaBlend `SRCALPHA, INVSRCALPHA` | Modulate `DESTCOLOR, SRCCOLOR` | Modulated `DESTCOLOR, SRCCOLOR` |
| 3 | AlphaModulate `ONE, INVSRCALPHA` | Translucent `ONE, ONE` | Translucent `ONE, ONE` |
| 4 | Translucent `ONE, INVSRCCOLOR` | Invisible `ZERO, ONE` | AlphaModulate `ONE, INVSRCALPHA` |
| 5 | Darken `ZERO, INVSRCCOLOR` | Brighten `ONE, INVSRCCOLOR` | Darken `ZERO, INVSRCCOLOR` |
| 6 | Brighten `SRCALPHA, ONE` | Darken `ZERO, INVSRCCOLOR` | Brighten `ONE, INVSRCCOLOR` |
| 7 | Invisible `ZERO, ONE` | | |
| 8 | Add (L2), pair unknown | | |

FinalBlend Translucent is a screen blend. Shader and particle Translucent are additive.
- Modes other than Overwrite, Normal without Opacity and Masked turn depth write off. A FinalBlend ZWrite then overrides.
- ZTest false sets the depth function to always. Invisible writes no colour.
- Particle modes keep destination alpha with `ZERO, ONE` on alpha.
- FB_Add renders `material-feature-unported:FrameBufferBlending`.

Both Modulates fog toward 127/255, neutral under `2 * src * dst`. AlphaModulate, both Translucents, both Brightens, Darken and Invisible fog toward black. Other world modes and terrain fog toward the fog colour. Reference particles fog only Translucent, AlphaModulate and Brighten to black, and Modulated and Darken to the fog colour.

### Fragment order

1. `c = Diffuse.rgb` times the ColorModifier and FadeColor colours on the diffuse path. `a` is the Opacity alpha, else the Diffuse alpha for masked or alpha textures, else 1.
2. Detail: `c = c * 2 * Detail.rgb` at `uv * DetailScale`, unless Detail has its own modifier.
3. Combiner, when Diffuse is one.
4. Alpha test against `AlphaRef / 255`. OB_Masked uses 127/255 and writes depth. The reference discards when `a < ref`.
5. Lighting `L`: lightmap texel for BSP, vertex bytes for static meshes and terrain, hardware actor lights for pawns and hardware-lit meshes, 1 when unlit. Modulate2X gives `o = c * 2 * L`, others `o = c * L`.
6. Specular: `o = o + SpecMask.a * S`, or `o = o * 2 * S` with ModulateSpecular2X. A FadeColor in Specular gives `S = 2 * fade`.
7. Self-illumination, only without Specular and with both inputs: `o = mix(o, SI, SIMask.a)`, `a = SIMask.a`.
8. Per-instance fade: `o = o * instanceColour`. Instance alpha replaces `a`, or multiplies it on masked materials. Discard when `a <= 0`. Actor and distance fade use this path.
9. Fog, then the blend and depth state.

### Combiner operations

`m` is the mask value, or `1 - m` with InvertMask. `c1, a1` come from Material1 and `c2, a2` from Material2, white when absent.

| Op | Colour |
|---|---|
| 0 Use_Color_From_Material1 | `c1` |
| 1 Use_Color_From_Material2 | `c2` |
| 2 Multiply | `c1 * c2 * k`, `k` = 1, 2 with Modulate2X, 4 with Modulate4X |
| 3 Add | `c1 + c2` |
| 4 Subtract | `c1 - c2` |
| 5 AlphaBlend_With_Mask | `c1 * m + c2 * (1 - m)` |
| 6 Add_With_Mask_Modulation | `c1 + c2 * m` (from the name, unconfirmed) |
| 7 Use_Color_From_Mask | `Mask.rgb` (from the name, unconfirmed) |

Alpha ops: 0 Use_Mask `m`, 1 Multiply `a1 * a2`, 2 Add `a1 + a2`, 3 From1 `a1`, 4 From2 `a2`. The reference implements only 3 and 4.
- Clamp each result to [0, 1], an unconfirmed fixed-function assumption.
- The mask channel is one constant, `combiner.mask-channel`.
- With no Mask, a colour op that reads it is a diagnostic. AO_Use_Mask with no Mask gives alpha 0, as the flame owner writes for Default_Flame01 (`src/scene/world/nativeMaterialGraph.ts:213-214` on native-world-slice). That rule is open.
- A Combiner is a full node anywhere, root included.

### UV modifiers

`t` is level seconds. Each sampler gets one 3x3 matrix per frame, the CPU product of its chain, outermost first as in the reference: `uv' = M_inner * ... * M_outer * uv`. A three-modifier fixture and an L2.exe swatch pin the order.

- TexPanner translates by `t * PanRate * (dir.x, dir.y)`, `dir` the PanDirection rotator as a unit vector.
- TexRotator converts rotator units through `src/shared/math/rotator.ts`, for now exact `angle = units * pi / 32768`. Fixed uses Rotation, ConstantlyRotating `angle * t`, Oscillating adds `A * sin(2*pi*(frac(t * rate / 65535) + phase))`, about `(UOffset / USize, VOffset / VSize)`.
- TexOscillator per axis: `o = A * sin(w * frac(t * rate) + 2*pi*phase)`, `w = 2*pi` for Pan and Stretch, `pi/2` for StretchRepeat. Pan adds `o`. Stretch and StretchRepeat use `u' = (u - k) * (1 + o) + k`, `k = UOffset / USize`. Jitter draws an offset of amplitude `A` per update from `tex-jitter`.
- TexScaler has UScale, VScale, UOffset and VOffset, with no reference, so a swatch decides their order.
- TexEnvMap: camera space `(View * R).xy * 0.5 + 0.5`, world space `R.xy * 0.5 + 0.5` (EnvMapType 0), cubemaps sample `R`. The reference flips camera-space cube lookups by `(-1, 1, -1)`.
- TexCoordSource selects any UV channel the mesh has.

The reference multiplies TexRotator and TexOscillator results by the serialized `M`, and uses identity for TexPanner, whose GetMatrix rebuilds `M`. Do not apply `M` on top without evidence.

### Colour sources and animated textures

- FadeColor: `q = (t + FadePhase) / FadePeriod`. Sinusoidal `w = 0.5 + 0.5 * cos(q * pi / 2)`. Linear is a triangle wave, `w = frac(q)` when `floor(q)` is odd and `1 - frac(q)` when even. Colour is `Color1 * w + Color2 * (1 - w)`. Authored alpha stays, zero included. The library stays byte-equal to the flame owner's binary32-then-floor sinusoid (`src/scene/world/nativeFlameMaterials.ts:75` on native-world-slice).
- ConstantColor is one colour. An unauthored ColorModifier Color takes its class default. An authored zero stays zero.
- AnimNext: `step = 1 / clamp(MaxFrameRate, 0.1, 100)`, `cycle = frames * step`. The phase is `t` minus whole cycles. From frame 0, each whole `step` subtracted advances the index by one, modulo frames. This matches the native tick at seams, where `floor(phase * fps)` does not (`nativeFlameMaterials.ts:91-108`).
- MaterialSequence (l2_skies.utx, lineagemonsterstex.utx) has no reference behaviour. Its fields come from the pinned class decompile, its timing from a side-by-side.

### Light intensity and colour

Values are source units, Z up. `D = L - P`, `d = |D|`, `R = 25 * (LightRadius + 1)`, `a = d / R`, `b = 2a^3 - 3a^2 + 1`.

- Default: 0 when `N.D <= 0` or `d > R`, else `2 * b * cos(theta)`.
- Sunlight: `2 * max(-dir.N, 0)`.
- Cylinder: `2 * max(0, 1 - (Dx^2 + Dy^2) / R^2)` when `d < R`, on source X and Y.
- NonIncidence: `2 * sqrt(1.02 - d / R)`, front-facing and `d < R`.
- QuadraticNonIncidence: `2 * (1.02 - d^2 / R^2)`, same tests.
- Spotlight and StaticSpot: `s = 1 - LightCone / 256`, `k = ((-D.dir) / d - s) / (1 - s)`, `I = default * k^2` inside the cone, else 0.

LightType factor `f`, with `n = floor(t * 35 * 65536 / max(floor(LightPeriod), 1) + 256 * LightPhase)` and `angle = 2*pi * (n mod 65536) / 65536`:
- Steady 1, Pulse `0.6 + 0.39 * sin(angle)`, SubtlePulse `0.9 + 0.09 * sin(angle)`.
- Blink 0 when `floor(t * 35 * 65536 / (LightPeriod + 1) + 256 * LightPhase)` is odd, else 1.
- Flicker `u < 0.5 ? 0 : u`, a `light-flicker` draw that the reference renews every 83 ms.
- Strobe's native rate is open. TexturePaletteLoop marks the light dynamic.

The colour plane comes from LightHue (segments split at 85 and 170, the last divided by 84) and LightSaturation (lerp toward white), scaled by `1.4 / (sqrt(1.4) + 0.01) * 0.7`. Baked bytes are `plane * LightBrightness * f * LevelBrightness`. Hardware colour is `plane * LightBrightness / 255 * f * LevelBrightness`, times 7/16 for the sun and 1/4 otherwise. bSunlightColor lights take plane and brightness from HSVStaticMeshLight when baked and HSVActorLight in hardware, and environment lights bake with HSVStaticMeshLight.

The D3D path takes up to 4 lights per actor, scored `round((1 - d^2 / (R + r)^2) * LightBrightness * 1024)` with `r` the bounding radius, the sun first and spots outside the cone at 0. Each light gets a denominator `c0 + c1 * d` through `(near, 1 / (2 * b(near / R)))` and `(far, 1 / (2 * b(far / R)))`, with `near = max(0, d - r) + 1` and `far = min(R, d + r) - 1`. `c0` clamps at 0 and `c1` refits through near. `I = 2 * max(N.L, 0) / (c0 + c1 * d)`, spots cut at `cos(pi / 4)`.

### Vertex and actor lighting

Each StaticMeshActor instance lists lights with visibility bits. A light reaches vertex `i` when bit `i & 7` of byte `i >> 3` is set. Batched instances offset `i` by their range start.

Each vertex byte is a base plus the sum over lights of `floor(colour_byte * 0.5 * ScaleGlow * w * I)`, clamped to 255. The base is 127 for unlit meshes (1.0 after Modulate2X), `(zone ambient + AmbientGlow) >> 1` when not sun-affected, and 0 when sun-affected, which adds halved StaticMeshAmbient(h) and a per-vertex sun term in the shader. `w` is 1, or the slot weight for environment lights. The static set caches, and dynamic and time-based lights re-add on change. Terrain uses the same bits without ScaleGlow.

Pawns and hardware-lit meshes start from the same base, add their hardware lights per vertex at half intensity and clamp to 1. Pawn output is `o = c * 2 * L`.

### Time of day

Env.int names four timeenv files, picked by environment type 0 to 3. The hour `h` is in [0, 24).
- Colour and scale tables hold `(T, value)` rows. Lerp between `T_i <= h < T_i+1`. Outside the span the reference returns the last row, so a sun table (T = 6 to 24) at `h < 6` yields its T = 24 row. Wrap is open.
- HSV tables lerp the two planes at full value, then multiply by `lerp(Bri) / 255`.
- Environment light slots: slot `i` of `n` sits at `(i + 0.5) * 24 / n`. Take the last slot at or before `h`, with wrap, and lerp to the next. `n` is the instance's environment-light count (`lineage2js/src/objects/lit-actor.ts:404-405`) or the sector's shadow-map count (`lineage2js/src/assets/unreal/un-terrain-sector.ts:436-443`). Env.int Num=8 is a check.
- BSP lightmap slot: truncate binary32 `h * n / 24`, then `mod n`. Indoor uses slot 0.
- Between server updates the hour advances at TimeRatio=6.

### BSP sections and lighting

VIS-01 builds sections with the reference key (`lineage2js/src/assets/unreal/model/un-model.ts:478-497`): material, the PF_Unlit and PF_TwoSided bits, lightmap texture index (-1 for none) and outdoor class ([02-bsp-visibility.md](02-bsp-visibility.md)). The reference also splits by sky zone, groups PF_AddLast surfaces as translucent and masks in the editor flag PF_Selected. Material-only grouping is dropped.

A section is outdoor when its zone is 0 (LevelInfo) or sun-affected, per the zone table and its zone-1 rule in `recipes/world/bsp-visibility.json`. `A(h)` is BSPAmbient, `S(h)` the BSP HSV light.
- Outdoor, lightmapped, not PF_Unlit: `o = clamp(2 * LM * c, 0, 1) * 2 * A(h)`.
- Outdoor, no lightmap: `L = A(h) / 2 + S(h) * 32 / 255`, `o = 2 * L * c`.
- Indoor with a lightmap, or outdoor PF_Unlit with one: `o = 2 * LM * c`.
- Indoor, no lightmap: `L` is the per-channel maximum zone ambient over the section's zones, halved, `o = 2 * L * c`. The reference draws zero ambient as unlit white, which is open.

The lightmap 2X is the `light.modulate2x` default. The lightmap UV is `(offset + (P * M).xy) / atlasSize`, with `M` the FLightmapIndex UV matrix, `offset` its atlas offset and the atlas size from the multi-lightmap's first texture. Each multi-lightmap holds one DXT1, DXT3 or DXT5 texture per hour slot. The base UV is `((P - pBase).vTextureU / width, (P - pBase).vTextureV / height)` over the material texture size, or 512 without one (`un-model.ts:55,558-560`).

### Terrain layers and lighting

- The layer UV is the layer TextureMatrix times world position. Our converter checks it against the load-time recomputation and accepts only XY, unrotated, unpanned layers (`scripts/native_map_geometry.py:405-424` on native-world-slice). Tile-general use needs TextureMapAxis, TextureRotation, LayerRotation and pans.
- The mask UV is `(grid + 0.5) / heightmapSize - max(grid - 240, 0) / 4096` per axis, recovered for 20_20 (`native_map_geometry.py:339,361`).
- Colour starts at layer 0. Each later layer applies `colour = layer.rgb * alpha + colour * (1 - alpha)`.
- Output is `colour * 2 * vertexLight`.
- Layers over the sampler budget go to extra passes blending `ONE, INVSRCALPHA` with premultiplied output, fogged before the premultiply.
- Vertex light per channel is `TerrainAmbient(h) / 2 + TerrainLight(h) * 0.5 * shadow / 255` plus the bit-masked static lights, `shadow` being the sector shadow-map byte. The reference lerps the two maps nearest in time, slot times `(i + 0.5) * 24 / n` with wrap.
- Our converter also keeps bUseAlpha. The WORLD-07 review and a side-by-side decide the alpha channel, premultiply and layer-0 masking.

### Fog

`f = clamp((z - start) / (end - start), 0, 1)` on view depth `z`. Colour mixes toward the family target. Each later source overrides the earlier:
1. Env.int preset: `StartRangeN * U` to `EndRangeN * U`, colour from the haze table. `U` is 2000 per the Env.int comment, 2048 in the reference.
2. Camera zone distance fog. A zone that is not sun-affected and has no distance fog turns fog off.
3. The nearest L2FogInfo within `max(AffectRange.A, AffectRange.B)`, searched over the 3x3 tiles around tile `floor(x / 32768) + 20`, `floor(y / 32768) + 18` and filtered by its zone mask. It uses `FogRange{preset}`, or FogRange1 when that is (0, 0). Colours interpolate by hour with wrap.
4. A water volume at the camera, with its own fog or Env.int [WaterVolume].

`src/scene/world/cameraEnvironment.ts` fills these inputs each frame: cameraZone from the VIS-01 `TileVisibilityFrame` and the volume from MOVE-01 containment ([03-movement.md](03-movement.md)). Fog state exports `fogEnd` per frame. Integration code in `src/runtime` or `src/camera` decides whether the camera far follows it, and the VIS-01 frustum reads the camera far.

The reference cross-fades a source change over a fixed 1 s and never reads FogSpeed (1 in Env.int). Water fog has no fade.

### Display gamma

The last pass applies `out = clamp((C + 0.5) * x^(1/G) + (B - C) * 32768 / 65535, 0, 1)` per channel as a 256-entry LUT. G = 0 means off. Gamma is Option.ini [Video] Gamma=1.200000. Brightness and Contrast are probably in l2.ini or user.ini [WinDrv.WindowsClient], both Lineage2Ver413, which the converter decodes offline with open-l2encdec from `.assets/native-tools` and hash-pins. The reference reads l2.ini, Option.ini, then user.ini.

### Edge cases

- Lighting data stays in source units (about 1 cm, Z up), as `asset.json` records, and light math runs there. Presentation converts once through `src/world/sourceFrame.ts`: `world = (x, z, y) * 0.01`, `source = (X, Z, Y) * 100`, right-handed, Y up.
- Triggered modifiers such as TexOscillatorTriggered (FX_E_T.utx) need a server Trigger (ARCH-01). They stay `material-class-unported:<class>` until a typed adapter record exists.

## Data inputs

| Input | Produced today by | Gap |
|---|---|---|
| Material graph from any root owner | `material_graph.py`, exact Engine.StaticMesh roots only; `static_materials.py` slot roots | BSP, terrain, skeletal, emitter and sky roots. Field schemas for FinalBlend, ColorModifier, ConstantColor, TexPanner, TexRotator, TexOscillator, TexOscillatorTriggered, TexScaler, TexEnvMap, TexCoordSource, VertexColor, Cubemap, MaterialSequence, OpacityModifier and fractal textures. program.json. |
| Class defaults | Actors DefaultReader (`scripts/native_effect_bundle.py`); data-ui `read_class_defaults` (`scripts/native_catalog/effects.py:264`), authored values only; planned world `read_class_evidence` and `resolved_static_values` (02-30) | One `scripts/native_assets_lib/class_defaults.py` walking the class chain; the others become thin callers or go. |
| Textures, lightmaps, alpha maps | `texture_mips.py:16`, `texture_dds.py:69-74`: licensees 20, 28, 30; P8, DXT1, DXT5 | DXT3, other licensees (rune_stakatonest_t.utx is 25) and version 118, through plan 02-53. |
| Environment program | `scripts/native_environment.py`, five sky sections typed | SunColor, SunScale, MoonColor, MoonScale, TerrainAmbient, ActorAmbient, StaticMeshAmbient, BSPAmbient, HSVTerrainLight, HSVActorLight, HSVStaticMeshLight, HSVBSPLight, [FOG], [WaterVolume] and three slot Num values, for types 0 to 3. |
| BSP lightmaps | Lightmap index only | Multi-lightmaps per hour slot, FLightmapIndex offset, size and UV matrix, uv2 in BSP GLBs, PF_Unlit, via `scripts/world/level_model.py`. |
| Zones and volumes | zoneClass in the bsp-visibility payload only | `scripts/world/level_zones.py`: class, bSunAffect resolution, ambient, distance fog, sky class. Water and physics volumes once from movement VOLS. Placement zones from `scripts/world/bsp_leaf_membership.py`. |
| Static mesh lighting | Placements from `scripts/native_map_geometry.py` | Instance light lists with visibility bits, ScaleGlow, AmbientGlow, bUnlit, bSunAffect, Light fields (LightEffect, LightHue, LightSaturation, LightBrightness, LightRadius, LightCone, LightType, LightPeriod, LightPhase, bDynamicLight, bSunlightColor), LevelInfo Brightness. |
| Terrain | nativeLayers with worldToTextureRowMajor, mask PNGs, the 20_20 mask rule, bUseAlpha | Shadow maps with serialized count, light bits, alpha channel per format (census), non-XY, rotated and panned layers, tile-general readers (plan 02-52). |
| Fog sources | None | ZoneInfo bDistanceFog, DistanceFogColor, DistanceFogStart, DistanceFogEnd from the zone table. L2FogInfo AffectRange, hour colours, FogRange1..5, bUseFogColorClear, zone mask from the lighting step. Water fog from VOLS. |
| Effects | `native_effect_bundle.py` effective properties | Map light records, ActorAmbient tables, emitter DrawStyle, Opacity and ColorScale. |
| Clocks and fade | `src/scene/world/nativeFlameReplayClock.ts` | `src/shared/presentationClock.ts`, the adapter `environment` event, per-instance fade colour and alpha. |
| Tile resource | Kinds fixed per plan (02-PLAN-INDEX.md:260) | A `lighting` `.l2asset` kind. |

## Constants

| ID | Value | Provenance | Status | Runtime default |
|---|---|---|---|---|
| blend.enum-ordinals | FB Overwrite 0, Modulate 1, AlphaBlend 2, AlphaModulate_MightNotFogCorrectly 3, Translucent 4, Darken 5, Brighten 6, Invisible 7, Add 8. OB Normal 0, Masked 1, Modulate 2, Translucent 3, Invisible 4, Brighten 5, Darken 6. PTDS Regular 0, AlphaBlend 1, Modulated 2, Translucent 3, AlphaModulate 4, Darken 5, Brighten 6. CO 0 to 7, AO 0 to 4 | `lineage2js/src/assets/unreal/un-material.ts:215-260,368-379`; `lineage2js/src/assets/unreal/emitters/un-particle-emitter.ts:871-879` | ue2-data | as listed |
| blend.fb-pairs | FinalBlend column; Add unknown; ZWrite overrides | `un-material.ts:399-412`; `lineage2js/src/materials/mesh-static-material/mesh-static-material.ts:310-378` | unconfirmed | reference; FB_Add a diagnostic |
| blend.ob-pairs | Normal, Masked, Modulate, Invisible, Darken | `un-material.ts:508-517` (C4 traces) | unconfirmed | reference |
| blend.ob-brighten-translucent | Brighten ONE,INVSRCCOLOR; Translucent ONE,ONE | `docs/NATIVE_FLAMES.md:9` on native-world-slice, the interludeEvidence source; matches `un-material.ts:508-517` | confirmed-interlude | as listed |
| blend.ptds-pairs | Particle DrawStyle column; alpha ZERO,ONE | `lineage2js/src/materials/particle-material/particle-material.ts:145-201`; `src/effects/nativeEffectMaterial.ts:152` on native-world-slice maps 3 to ONE,INVSRCCOLOR and 6 to ONE,ONE | unconfirmed | reference pairs are the target; shipped 3 and 6 stay until the swatch verdict |
| blend.alpha-test | OB_Masked 127/255 with depth write; discard when `a < ref` | `mesh-static-material.ts:315-320` | unconfirmed | reference |
| blend.bare-texture | bMasked test 127/255; bAlphaTexture SRCALPHA,INVSRCALPHA | `lineage2js/src/assets/decoders/material-decoder.ts:596-616`; `mesh-static-material.ts:224-227` | unconfirmed | reference |
| fog.targets | families in Blend table and fog family | `lineage2js/src/materials/shader-chunks/l2_fog_fragment.glsl:8-16`; `mesh-static-material.ts:206-214`; `lineage2js/src/materials/mesh-terrain-material/shader/shader-mesh-terrain.fs:90`; `particle-material.ts:53-57,166-196` | unconfirmed | reference |
| fog.factor | linear on view depth; no exponential fog | `l2_fog_fragment.glsl:2-6` | unconfirmed | reference |
| fog.env-presets | StartRange1..5 = 1.0, 1.5, 2.0, 2.5, 4.0; EndRange1..5 = 4.0, 5.0, 6.0, 7.0, 10.0; FogSpeed 1 | client `system/Env.int` [FOG], decoded read-only | ue2-data | preset 4, the reference default, as a constant |
| fog.range-unit | 2000 per the Env.int comment; reference 2048 | `lineage2js/src/rendering/render-manager.ts:2032-2040`; Env.int [FOG] comment | unconfirmed | 2048 |
| fog.source-precedence | water, L2FogInfo, zone, preset, with the rules in Fog | `render-manager.ts:2026-2074,2108-2153,2214-2224,2307-2321` | unconfirmed | reference |
| fog.cross-fade | fixed 1.0 s; FogSpeed unused; water skips it | `lineage2js/src/rendering/l2-env.ts:28`; `lineage2js/src/assets/unreal/conf-files/un-conf-env.ts:212-213`; `render-manager.ts:2286,2307` | unconfirmed | 1.0 s |
| fog.water-volume | colour (39, 87, 126), start 200, end 3000; cellophane A 128, R 45, G 121, B 117 | client `system/Env.int` [WaterVolume]; `un-conf-env.ts:234-267` | ue2-data | as listed |
| light.modulate2x | x2 for lightmaps, vertex-lit meshes and terrain | `mesh-static-material.ts:146,163`; `lineage2js/src/materials/mesh-static-material/shader/shader-mesh-static.fs:716-733`; `shader-mesh-terrain.fs:66-67` | unconfirmed | x2 on all three |
| light.static-lighting-2x-default | Engine.Shader authors only DetailScale=8, so ModulateStaticLighting2X defaults false; the reference treats missing as true | `src/scene/world/nativeMaterialGraph.ts:120` on native-world-slice; `un-material.ts:503` | unknown | program.json records class-default false; lightmaps keep light.modulate2x |
| mat.detail | DetailScale 8 for Engine.Shader and Engine.Texture; `c * 2 * Detail.rgb` | `nativeMaterialGraph.ts:120`; `shader-mesh-static.fs:624-630` | unconfirmed | as listed |
| mat.self-illumination | `mix(o, SI, SIMask.a)`; skipped with Specular | `shader-mesh-static.fs:784-791`; `material-decoder.ts:567` | unconfirmed | reference |
| light.bake-halving | `0.5 * ScaleGlow`, floored; terrain omits ScaleGlow | `lineage2js/src/objects/lit-actor.ts:208-216`; `lineage2js/src/objects/terrain.ts:312-318` | unconfirmed | reference |
| light.vertex-base | bases in Vertex and actor lighting | `lit-actor.ts:448-499`; `lineage2js/src/materials/mesh-static-material/shader/shader-mesh-static.vs:474-480` | unconfirmed | reference |
| light.effect-type-ids | LE_StaticSpot 8, LE_Spotlight 12, LE_NonIncidence 13, LE_Cylinder 17, LE_Sunlight 19, LE_QuadraticNonIncidence 20; LT_Steady 1, Pulse 2, Blink 3, Flicker 4, Strobe 5, SubtlePulse 7, TexturePaletteLoop 9 | `lineage2js/src/materials/shader-chunks/actor_light.glsl:1-6`; `lineage2js/src/objects/dynamic-light.ts:69-82` | ue2-data | as listed |
| light.falloffs | per LightEffect in Light intensity and colour | `actor_light.glsl:19-80`; `dynamic-light.ts:400-473` | unconfirmed | reference |
| light.radius | `25 * (LightRadius + 1)` source units | `dynamic-light.ts:381` | unconfirmed | reference |
| light.type-factor | Pulse, SubtlePulse, Blink, Flicker; Flicker renew 83 ms | `dynamic-light.ts:246-290` | unconfirmed | reference; Strobe renders steady and the dev sheet flags it |
| light.hsv-plane | hue split 85 and 170, divisor 84, scale `1.4 / (sqrt(1.4) + 0.01) * 0.7` | `dynamic-light.ts:84-106` | unconfirmed | reference |
| light.hardware-colour | sun 7/16, others 1/4 | `dynamic-light.ts:292-299` | unconfirmed | reference |
| light.d3d-fit | near and far fit, `c0 >= 0`, spot cut `cos(pi / 4)` | `dynamic-light.ts:199-227`; `actor_light.glsl:40-46` (C4 D3DDrv) | unconfirmed | reference |
| light.actor-count-score | 4 lights per actor, 8 hardware slots, sun first | `mesh-static-material.ts:15-17`; `dynamic-light.ts:384-398` | unconfirmed | reference |
| light.sun-direction | pitch `(h - 6) * pi / 18 - pi / 2` for h in [5, 24), `(h + 18) * pi / 18 - pi / 2` for [1, 5); moon when h < 7 or h >= 23; tilt 30 degrees = SlopeSunAngle | `dynamic-light.ts:19-67` | unconfirmed | reference |
| time.table-sampling | bracketing lerp, last row outside the span, HSV rows per Time of day; FogInfo colours wrap | `l2-env.ts:331-411,413-454` | unconfirmed | reference |
| time.env-slot-counts | [TerrainShadowMap] Num=8 AutoTimeGeneration=true; [ActorStaticLight] Num=8; [BSPSunLight] Num=8 | client `system/Env.int`, decoded read-only | ue2-data | check only |
| time.slot-time | `(i + 0.5) * 24 / n`, wrap, lerp to next | `l2-env.ts:299-320`; `lineage2js/src/assets/unreal/un-terrain-sector.ts:442` | unconfirmed | reference |
| env.setup | TimeEnvFileNum=4, StartTime=12, TimeRatio=6, SlopeSunAngle=30, StaticLightingAdjust=4, ShadowTick=0.1, IsClock=true, SubLightNum=0 | client `system/Env.int` [EnvSetup]; timeenv0..3.int [EnvType] | ue2-data | StartTime 12, type 0 without server time |
| bsp.sun-term | `BSPAmbient(h) / 2 + BSPLight(h) * 32 / 255` | `l2-env.ts:140-161`; `lineage2js/src/objects/zone-object.ts:1496-1499` | unconfirmed | reference |
| bsp.lightmap-slot | truncate binary32 `h * n / 24`, `mod n`; indoor 0 | `mesh-static-material.ts:397-403`; `zone-object.ts:1528` | unconfirmed | reference |
| bsp.base-uv-size | material texture size, or 512 | `lineage2js/src/assets/unreal/model/un-model.ts:55,558-560` | unconfirmed | reference |
| terrain.shadow-blend | lerp of the two nearest shadow maps | `terrain.ts:86,144-148,195-201` | unknown | lerp |
| terrain.sun-term | per Terrain layers and lighting | `terrain.ts:150-151,203-210` | unconfirmed | reference |
| terrain.mask-uv | 20_20 mask rule in Terrain layers and lighting | `scripts/native_map_geometry.py:339,361` on native-world-slice; `un-terrain-sector.ts:305-306` | unconfirmed | as listed |
| terrain.layer-matrix | serialized TextureMatrix, checked against TextureRotation, UScale, VScale, UPan, VPan, TextureMapAxis, LayerRotation | `lineage2js/src/assets/unreal/un-terrain-info.ts:525-592`; `scripts/native_map_geometry.py:405-424` | ue2-data | serialized matrix |
| uv.modifiers | TexPanner, TexOscillator, TexEnvMap, FadeColor and AnimNext formulas | `shader-mesh-static.vs:407-444,752-796`; `un-material.ts:305-312,793-807`; `shader-mesh-static.fs:542-558`; `src/scene/world/nativeFlameMaterials.ts:75,91-108` on native-world-slice | unconfirmed | reference |
| uv.rotator-conversion | exact `units * pi / 32768` or the float32 sine table, one choice per use in `src/shared/math/rotator.ts` | `shader-mesh-static.vs:407-416` | unconfirmed | exact until the Core.dll SinTab re-derivation |
| combiner.mask-channel | green in the reference | `shader-mesh-static.fs:653-660` | unknown | green |
| colour.byte-order | B, G, R, A (reference, nativeMaterialGraph.ts:219) or R, G, B, A (native_sky.py:166) | `lineage2js/src/assets/unreal/un-color.ts:37-43`; `src/scene/world/nativeMaterialGraph.ts:219`; `scripts/native_sky.py:166` on native-world-slice | unknown | B, G, R, A until the R != B fixture |
| gamma.ramp | formula in Display gamma; G = 0 off | `lineage2js/src/rendering/display-gamma.ts:7,53-57` (C4 D3DDrv UpdateGamma) | unconfirmed | reference |
| gamma.setting | Option.ini [Video] Gamma=1.200000, TerrainClippingRange=0; [ClippingRange] Terrain=8.0; no Brightness or Contrast keys | client `system/Option.ini`, read-only | ue2-data | G = 1.2 |
| gamma.brightness-contrast | reference defaults Brightness 0.8, Contrast 0.7, Gamma 0.8; steps 1.2, 1.0, 0.8, 0.6, 0.4 | `lineage2js/src/assets/unreal/conf-files/un-conf-system.ts:40-44`; `display-gamma.ts:5` | unconfirmed | B 0.8, C 0.7 until l2.ini and user.ini decode |

## Interlude differences

| Item | Detail | How to confirm |
|---|---|---|
| Four environment types | Interlude Env.int (5,943 bytes, Lineage2Ver111, XOR 0xAC) sets TimeEnvFileNum=4 for timeenv0..3. The reference loads three (`un-conf-env.ts:318-328`; `l2-env.ts:83`). | Compare each type against L2.exe under the matching server state in Phase 3. |
| Ignored Env.int sections | [TerrainShadowMap], [ActorStaticLight], [BSPSunLight], [WIND], [EnchantEffect], [Variation] and the [S1]..[S5] glow and HDR presets exist, with ';[S0] means postprocessing off'. | Type them, then decide per section by side-by-side. |
| Time table shape | Most colour sections have 25 rows, T=0..24. Sun tables have 5 rows at T=6..24 and moon tables 5 at T=0..6. timeenv3 SkyBoxColor declares NUM=1 against 25 rows. [HSVTerrainLight] appears twice in timeenv1 and timeenv3. | An owner rule on anomalies. A side-by-side at h = 3 and h = 23.5 settles wrap. |
| Material classes in use | A name-table census found TexScaler in LineageEffectsTextures.utx, rune_stakatonest_t.utx, New_Giran_T.usx and AdenNew_T2.utx; MaterialSequence in l2_skies.utx, lineagemonsterstex.utx and lineagemonsterstex2.utx; TexOscillatorTriggered and ConstantColor in FX_E_T.utx; ConstantColor also in LineageEffectsTextures.utx. MaterialSwitch, TexPannerTriggered and TexMatrix appear only in Engine.u. Name counts: Shader 455, ColorModifier 152, FinalBlend 86, TexCoordSource 58 (also a field name), TexEnvMap 42, TexPanner 36, Combiner 27, FadeColor 19, TexOscillator 18, VertexColor 15, Cubemap 14, TexRotator 7. | The step 2 census counts export objects by class reference. |
| Binaries | Engine.dll 4dd2f63c... has UL2NEnvManager, UL2NTimeLight, GetSunModifierInfo, SetIntensityMap, FGetHSV, UpdateGamma, UTexScaler, UFinalBlend and MaterialSequence. D3DDrv.dll 05622dde... has UpdateGamma, UTexScaler, UTexRotator, UFadeColor and UFinalBlend. lineageenv.dll has none. C4 addresses do not carry over. | POL-04 starts from these names and records name, offset and hash in interludeEvidence. |
| Package versions | Most packages are version 123 with licensees 0x00 to 0x1F. Direction.utx, L2_RadarMap.utx, L2UI_CH3.utx and l2_skies.utx are version 118. | Plan 02-53 widens the readers under texture-licensee-unsupported and static-material-layout-unreviewed. |

## Do not copy

- ColorModifier stand-ins: zero colour to white, zero alpha with nonzero RGB to 1, a /255 rescale when a channel exceeds 1 (`material-decoder.ts:426-439`).
- Nested Shader collapsed to Diffuse and nested Combiner to Material1 (`material-decoder.ts:502-507`).
- Root Combiner Mask passed through the specular slot (`material-decoder.ts:518-542`; `shader-mesh-static.fs:653-660,803-808`).
- CO 6 and 7 falling back to Material1, and missing AO_Use_Mask, AO_Multiply and AO_Add (`un-material.ts:331-350`).
- TexCoordSource above 1 throwing (`material-decoder.ts:411-414`). Chains capped at two stages (`transform-stage.ts:4`) on five slots, not Material2 (`mesh-static-material.ts:13`).
- Constant Jitter (`shader-mesh-static.vs:440-441`), unscaled OscillationPhase and the 65535 divisor (`:415-416`), serialized `M` applied after the computed matrices (`:452-458`).
- The GL viewer comment block with other blend pairs (`un-material.ts:262-294`).
- A missing ModulateStaticLighting2X treated as authored true (`un-material.ts:503`).
- Time-table stand-ins: white 255 for empty tables (`l2-env.ts:391,405`), grey 128 for empty FogInfo colours (`l2-env.ts:419`), black when actor sun rows match (`l2-env.ts:126`).
- Haze accumulation snapping weights at 0.95 from a white base (`render-manager.ts:2246-2269`).
- Fog fade stepped by the view-shake delta (`render-manager.ts:2286`), the fog preset from a localStorage UI value (`lineage2js/src/game/ui-manager.ts:26`), zone fog in sun-affected zones only with streaming off (`render-manager.ts:2065`).
- rAF and performance.now clocks (`render-manager.ts:1903`; `dynamic-light.ts:230`), Math.random Flicker (`dynamic-light.ts:261-271`), per-call Strobe (`dynamic-light.ts:272-284`), a hard-coded game-time scale (`lineage2js/src/network/network-session.ts:22`).
- Terrain `.r` from every alpha format, premultiplied uploads, unmasked first layer (`mesh-terrain-material.ts:80-101`), and the stock three fog, tone-mapping and colour-space chunks (`shader-mesh-terrain.fs:87-91`; `shader-mesh-static.fs:830-832`).
- Particle frames by `floor(time / framerate) mod count` (`particle-material.ts:131-138`).
- VertexColor ignored (`un-material.ts:779-784`), FB_Add as a console warning (`un-material.ts:411`).
- WetTexture's wave automaton, the reference's own model (`un-package.ts:439`).
- C4 RVAs, trace call numbers and UE2 engine source citations in comments (`un-material.ts:327-328,399`, `lit-actor.ts:452,459`, `dynamic-light.ts:286,383`, `shader-mesh-static.vs:409,414`, `un-model.ts:490`). Do not seek or use UE2 engine source.

## Our code today

Code truth is native-world-slice at 22de53a. Planning truth is plan/autonomous-roadmap at 56bf9f7.

Converter:
- `scripts/native_assets.py:249-255` binds one texture per slot through Shader.Diffuse and FinalBlend.Material. Lines 277-343 map AlphaTest to glTF MASK and TwoSided to double-sided. Unbound slots become magenta `UNBOUND_SOURCE_SLOT` (:333).
- `scripts/native_assets_lib/material_graph.py` writes `native-materials/graph.json` (property tags, payload hex, raw exports, edges, class definitions, mips, DDS) only for an exact Engine.StaticMesh under `preserve-native-graph`. It reviews Texture, Shader, Combiner, FadeColor and Palette (:12), caps at 128 nodes (:13) and lists runtime gaps (:15).
- `scripts/native_environment.py` keeps all 1,681 properties but types only five sky sections (:24-26, :106).
- `scripts/native_sky.py:166` reads ColorModifier Color as RGBA.
- `scripts/native_map_geometry.py:405-424` refuses non-XY, rotated or panned terrain layers.
- `scripts/native_bsp_building.py` and `native_bsp_floor.py` record only the lightmap index.

Runtime:
- `src/scene/world/nativeMaterialGraph.ts:79` validates only Default_Flame01: two Shaders with OutputBlending 5 and 3 (:206), one Combiner (Multiply, Modulate2X, AlphaOperation 0, Mask None), one FadeColor, an AnimNext chain. It applies DetailScale 8 (:120), checks ModulateStaticLighting2X inactive (:205) and decodes FColor as BGRA (:219).
- `src/scene/world/nativeFlameMaterials.ts` holds the fade model (:75), frame tick (:93), two hand-written unlit shaders (:56) and pinned ALPHA_SCREENMODE and ALPHA_ONEONE_ONEONE states (:229).
- `src/effects/nativeEffectMaterial.ts` accepts DrawStyle 3 or 6 only (:124), mapping 3 to ALPHA_SCREENMODE and 6 to ALPHA_ONEONE (:152) as a preview.
- `src/scene/world/nativeTerrainPreview.ts:135-218` draws nine layers with exact UV matrices but no lighting, Modulate2X or fog.
- `src/scene/world/terrainSurfaces.ts:123-126` blends in sRGB with an invented `0.45 + 0.55 * N.L` light. It belongs to the Talking Island reference route, which the native-world-slice cleanup removes.
- `docs/NATIVE_WORLD.md:13` says scene fog is off and links `src/scene/presentationConfiguration.ts` and `docs/OUTPUT_CONTRACT.md`, which exist only on plan/autonomous-roadmap.
- No material evaluator, lighting, L2 fog, display gamma or swatch route exists yet.

## Design

### Principles

- Offline converters read every package. The browser reads typed JSON, `.l2asset` payloads and texture archives.
- Colour stays in the byte domain end to end, and every gap is a visible, named diagnostic (ARCH-03).
- Lineage2JS (`.assets/reference/lineage2js`, 854f629) is read to learn a mechanism. Code comes from these notes.

### Converter

- `material_graph.py` accepts any root owner with an owner record. `graph.json` keeps its shape. Reviewed classes grow to the census list, each with a field schema (name, UE type, enum name) from the pinned UELib decompiles.
- `material_program.py` writes `native-materials/program.json`: `schemaVersion: 1`, `kind: 'ue2-material-program'`, `graphSha256`, `roots: [{slot, owner, node}]`, `nodes: [{id, class, status, fields, provenance}]`. `id` is the qualified object name, and `status` is `reviewed` or `unported` with its reason. Enums carry name and ordinal, references node ids, colours RGBA bytes after the byte-order fixture. Each field is authored, class-default or ue-zero, from `class_defaults.py`. Texture nodes point at archives by hash. The converter flattens, evaluates and invents nothing.
- The converter returns reasons and writes no gap rows. World steps and the actors effect bundle write rows for their own parts (`.planning/phases/02-stage-a-breadth/02-02-PLAN.md:38`). Both reason names live in the integration seed list `scripts/native_store/gap_reasons.json`.
- Plan 02-45's sky reader calls `material_graph.py`. Plan 02-53 owns licensee, DXT3 and version-118 growth.
- `scripts/native_environment.py` (world) types every section for four environment types and keeps the anomalies.
- `scripts/world/lighting_step.py` (world) writes one `lighting` `.l2asset` per tile through `scripts/world/typed_payload.py`. `asset.json` records units source, axes UE2 Z up, source SHA-256 and converter version. Typed, 4-byte aligned little-endian arrays hold lights, fog infos, level brightness, light bits, terrain shadow maps and per-slot lightmap DXT blocks. `src/shared/typedPayload.ts` reads it.

### Model library and constants

Vitest and workers load `src/materials/ue2/model/**`. Files: `program.ts` (bounded, exact parser), `blendTable.ts` (factor pair, depth default, fog family), `texMatrix.ts`, `colorSources.ts`, `textureFrames.ts` (moved from nativeFlameMaterials.ts), `combiner.ts` (CPU twin), `lightFalloff.ts`, `vertexLight.ts` (bit decode, bake to Uint8Array), `timeOfDay.ts`, `fog.ts`, `displayGamma.ts` (256-entry LUT) and `stagePlan.ts`.

`constants/*.ts` has one file per id family. Rows are `{id, value, provenance, status, interludeEvidence, runtimeDefault}`, with status ue2-data, unconfirmed, confirmed-interlude, corrected-interlude or unknown. interludeEvidence holds binary SHA-256, export or VA, and offset, null until evidence exists. A POL-04 change is one row edit plus test updates.

### Stage plan and Babylon binding

The compiler turns a root into a stage plan: samplers (texture node, frames, coordinate source, matrix chain, address modes), constants, an op tree, lighting kind, blend pair, depth flags, alpha reference and fog family. The key hashes the structure. Textures, constants and CPU-built matrices are uniforms, so one shader serves many materials and chains have no depth cap. Over 16 sampled textures is a diagnostic, except terrain, which splits into passes.

In `src/materials/ue2/babylon/**`:
- Shaders are WGSL. GLSL is a fallback only if the spike fails, recorded as an accepted platform dependency.
- Candidate presets: ALPHA_DISABLE ONE,ZERO; ALPHA_COMBINE SRCALPHA,INVSRCALPHA; ALPHA_PREMULTIPLIED ONE,INVSRCALPHA; ALPHA_SCREENMODE ONE,INVSRCCOLOR; ALPHA_ADD SRCALPHA,ONE; ALPHA_ONEONE ONE,ONE; probably ALPHA_SUBTRACT ZERO,INVSRCCOLOR. DESTCOLOR,SRCCOLOR needs custom factors, or Modulate stays a diagnostic. Invisible disables colour writes. The spike checks every pair with alpha factors.
- disableDepthWrite follows ZWrite, depthFunction is LEQUAL or ALWAYS from ZTest, backFaceCulling follows TwoSided with the axis swap's mirrored winding.
- Textures upload as RGBA8 unorm, `gammaSpace = false`, native mips, no premultiply, clamp modes from UClampMode and VClampMode, BC formats when supported.
- A worker fills an updatable `ue2Light` buffer of normalized ubytes. Lightmaps swap one texture per hour slot.
- Scene fog stays off. One gamma PostProcess writes alpha 1 with image processing and tone mapping off.
- One uniform buffer holds level seconds, hour, environment type, fog state, ambient planes and sun direction.
- For particles `material.ts` exports the fragment chain, PTDS pair, fog family, texture frames and uniform layout, and particles own the vertex stage ([04-particles.md](04-particles.md)). VIS-01 orders BSP blocks inside a mesh ([02-bsp-visibility.md](02-bsp-visibility.md)).

### Clock, game time and environment type

- Level seconds come from `src/shared/presentationClock.ts`, which replaces the flame replay clocks and pauses and seeks like them (`docs/NATIVE_FLAMES.md:10`). Replays drive it at a fixed `dt`.
- Game hour and environment type are server-fed values, not a clock. They arrive as `environment {gameMinutes, environmentType}`, from the integration contract commit that precedes adapter code. The five GameWorldAdapter methods stay frozen (ARCH-02).
- The network game-time step decodes CharSelected 0x15 game time and the SunRise 0x1C and SunSet 0x1D packets into that event ([05-network.md](05-network.md)). The reference takes `gameTime / 60` as the hour and snaps to 7:00 and 1:00 (`network-manager.ts:985-986`). Network owns the open question of the environment type source.
- Adapters never read Env.int. Without server time the runtime starts at StartTime=12, type 0, from the env program.

### Shared modules and boundaries

- Integration lands `src/shared/**` first. `random.ts` streams derive as `hash32(sessionSeed, domain, ...ids)`, here with domains `light-flicker` and `tex-jitter`. Light and UV math build on `src/shared/math/`.
- One integration comparator in `src/runtime/` (`scene.setRenderingOrder`) sorts translucent meshes by distance, then per-actor emitter ordinal. No material sets an absolute alphaIndex.
- This area exports `blendTable.ts`, `fog.ts` and `textureFrames.ts` from `src/materials/ue2/model/`, and the factory and particle hook from `src/materials/ue2/babylon/material.ts`. World and actors import only `material.ts`.
- `src/world` and the adapters import nothing from `src/materials`. The runtime copies clock values into the globals.
- `src/runtime/materialSwatch.ts` serves `/?world=interlude&swatch=<object>&t=&hour=&env=` and the dev sheet.
- `tests/unit/importBoundaries.materials.test.ts` (helpers in `tests/support/staticImportGraph.ts`) fails when `src/materials/ue2/model/**` imports `@babylonjs/*`, a package, the DOM or anything outside itself but `src/shared/**`, or when `src/world` or an adapter imports `src/materials`. The shared rule against `@recast-navigation/*`, `@babylonjs/materials` and `@babylonjs/node-particle-editor` outside the lazy inspector entry applies.

### ARCH-03 rulings on reference fallbacks

- An empty time table fails conversion instead of turning white or grey.
- A missing BSP table fails the env program. The reference falls back to StaticMesh tables, which never runs if all four timeenv files carry BSP tables.
- The dev sheet flags indoor sections with zero ambient until a side-by-side decides them.

### Tests, fixtures and overlap

- Model functions get goldens through `tests/support/goldenTrace.ts` and its float32-ulp comparator. `compile.ts` gets one snapshot per plan. Playwright reads back a swatch grid for GPU parity.
- Committed fixtures in `tests/fixtures/ue2-materials/**` are synthetic, or indices and hashes only. Synthetic Level.Model scenes come from `tests/pipeline/support/`. Real-client cases read the client through `--client` at test time and skip with a reason when absent.
- `tools/reference-overlap/` runs on every change with the README thresholds. The materials globs are `src/materials/ue2/**`, `scripts/native_assets_lib/material_*.py` and `scripts/world/lighting_step.py` against `lineage2js/src/{materials,rendering,objects,assets}/**` at 854f629. A reviewer who did not write the code also reads the shaders for copied comments, addresses or identifier sets and signs off in the owning part's EVIDENCE.md.

## No vendor dependencies

| Reference uses | For | We use |
|---|---|---|
| three ~0.186 (ShaderMaterial, ShaderChunk, UniformsLib.fog, blend constants, math, DataTexture, WebGLRenderTarget, FullScreenQuad, generateUUID) | Materials, fog, blending, gamma blit, keys | Babylon ShaderMaterial, ShaderStore, RawTexture and PostProcess as platform; our blendTable.ts, WGSL chunks and `src/shared/math/`; converter hashes as keys |
| three-wasm (git): Matrix4, Euler, SortedIndexBuffer | Matrix math, translucent sorting | `src/shared/math/`; VIS-01 and the integration comparator |
| @l2js/core (git): package reader, UEncodedFile, property maps | Browser-side package and Env.int reads | Offline Python readers (`scripts/native_catalog/ue2.py`, `material_graph.py`, `native_environment.py`). `@l2js/engine` is an in-repo alias of the reference. |
| gmp-wasm and pako | Lineage2Ver413 RSA and zlib | Offline decoding with open-l2encdec; DecompressionStream if a browser inflate is ever needed |
| three DDSLoader (`lineage2js/src/assets/decoders/texture-decoder.ts:3`) and the in-repo CPU DXT decoder | Texture and lightmap decoding | Native DXT blocks from texture_dds.py, uploaded as BC when available, else the converter's RGBA derivative |
| @dimforge/rapier3d (`lineage2js/src/objects/terrain.ts:6`) | Terrain colliders | None here. Collision is MOVE-01 ([03-movement.md](03-movement.md)). |
| WebGL2 transform feedback | GPU vertex relighting | A CPU worker on model/vertexLight.ts; WebGPU compute only if PERF-02 calls for it |
| raw-loader and webpack | Shader text | Vite ?raw or ShaderStore strings |
| glslang and twgsl compilers served from the /vendor/babylon/9.27.1/ URL (`src/engine/createWebGPUEngine.ts:9-39`) | Babylon's GLSL path under WebGPU | WGSL; if the spike forces GLSL, an accepted platform dependency |
| @babylonjs/materials, @babylonjs/node-particle-editor, @recast-navigation/* | Nothing here | No semantics. @recast-navigation/* leaves runtime dependencies, and the import-boundary rule keeps all three out of `src/**` outside the lazy inspector entry. |

## Shared modules

- `src/shared/presentationClock.ts`
- `src/shared/random.ts`
- `src/shared/math/`
- `src/shared/math/rotator.ts`
- `src/shared/typedPayload.ts`
- `scripts/world/typed_payload.py`
- `src/world/sourceFrame.ts`
- `scripts/world/level_model.py`
- `scripts/world/level_zones.py`
- `scripts/world/bsp_leaf_membership.py`
- `scripts/native_assets_lib/class_defaults.py`
- src/materials/ue2/model/blendTable.ts and src/materials/ue2/model/fog.ts
- `src/materials/ue2/model/textureFrames.ts`
- `src/materials/ue2/babylon/material.ts`
- src/runtime/ (scene.setRenderingOrder setup)
- `src/scene/world/cameraEnvironment.ts`
- `tests/pipeline/support/`
- `tests/support/goldenTrace.ts`
- tests/support/staticImportGraph.ts and tests/unit/importBoundaries*.test.ts
- `tools/reference-overlap/`
- scripts/native_store/gap_reasons.json plus recipes/world|actors|data/gap-reasons.json
- src/materials/ue2/model/constants/ (row shape in README.md)

## Acceptance

- Vitest goldens on synthetic fixtures for `src/materials/ue2/model`: each FB, OB and PTDS value to a pair or diagnostic; UV matrices per modifier at t = 0, 0.25, 1 and 10 s and a three-modifier chain; both FadeColor types at 12 samples, sinusoidal byte-equal to `evaluateNativeFlameFade`; frames equal to `selectNativeFlameFrame` at seams; Combiner ops on 8 input pairs; falloff per LightEffect at d = 0.5R, d = R, back-facing and the cone edge; a 19-vertex bake with a 3-byte mask; table sampling at h = 0, T_i, T_i + 0.5, 23.99 and 24 with a NUM mismatch; lightmap slot `floor(h / 3)` for n = 8; fog precedence; the gamma LUT at G = 1.2, C = 0.5, B = 0.5.
- `tests/unit/importBoundaries.materials.test.ts` passes and fails on a planted bad import.
- Pytest (`tests/pipeline/test_native_material_program.py`) on synthetic packages: each root owner kind, per-field provenance, an unknown class as an unported node with reason and magenta slot, an R != B byte-order fixture. Via `--client`, skipped with a reason when absent: Default_Flame01 carries today's validated values, and the env program types all four timeenv files with anomalies kept.
- Playwright on SwiftShader WebGPU (`tests/browser/ue2Swatch.spec.ts`): every blend mode over a known background and each fog family at f = 0, 0.5, 1 match the CPU twin within 1/255, 2/255 with filtering. Missing classes and textures show magenta with a reason. No scene fog, image processing or sRGB format is active.
- Default_Flame01 through the library passes `tests/browser/nativeFlame.spec.ts` unchanged (24 bindings, 17 textures, frame 6 at 0.21 s) and is pixel-equal to today at three replay times.
- The comparator test passes with a Power Strike in front of and behind a water sheet.
- The /?world=interlude swatch route shows source object, stage plan, blend pair, fog family and constant status for any material id, hour and environment type.
- Phase 3 on IMPORTA-PC, L2.exe and the sandbox at one 20_20 camera (CHECK-01): a lightmapped BSP hall, terrain at hours 6, 12 and 21, a static mesh by a light, flames at night, the sky at a fixed hour. Verdicts go in `docs/parts/world/EVIDENCE.md` (CHECK-03), unverified is never a pass, and fixes land in shared code (CHECK-04).
- Phase 5 (POL-04): each unconfirmed or unknown row gets interludeEvidence and becomes confirmed-interlude or corrected-interlude, or stays listed with a reason.
- `tools/reference-overlap/` passes on every merge, with the independent sign-off in EVIDENCE.md.
- Per-frame update time, shader variant count and compile time on 20_20 are logged as WORLD-04 and PERF-02 baselines.

## Implementation steps

1. 1. Spike (integration) Requirement: MAT-01. Output: A `docs/research/` note on Babylon 9.27.1 WebGPU: WGSL ShaderMaterial, custom DESTCOLOR,SRCCOLOR, the real factors of the candidate presets, a shared uniform buffer, RGBA8 unorm sampling, ubyte attributes, the gamma pass Check: One read-back pixel per factor pair matches the CPU within 1/255.
2. 2. Census (integration) Requirement: MAT-01. Output: `scripts/audit-material-census.py`, read-only with `--client`: objects per class, enum and op values, texture and lightmap formats Check: Counts come from export class references; the hash-pinned output sets the reviewed-class list.
3. 3. Class-default reader (integration, with actors and data-ui) Requirement: CONV-02. Output: `scripts/native_assets_lib/class_defaults.py`; the other readers become thin callers or go Check: Effect and flame pipeline tests pass unchanged.
4. 4. Converter graph and program (integration) Requirement: MAT-01, CONV-02. Output: Any-root material_graph.py, field schemas, byte-order fixture, material_program.py Check: Pytest passes; the flame graph.json is byte-identical.
5. 5. Model library (integration) Requirement: MAT-01. Output: `src/materials/ue2/model/**`, flame fade and frame helpers moved in Check: Goldens and the boundary test pass.
6. 6. Babylon binding (integration) Requirement: MAT-01. Output: `src/materials/ue2/babylon/**` Check: The swatch parity grid passes.
7. 7. Swatch route (integration) Requirement: MAT-01. Output: `src/runtime/materialSwatch.ts`, dev sheet Check: Swatch acceptance passes.
8. 8. Environment record (integration contract commit) Requirement: ARCH-02, ARCH-04, MAT-02. Output: `environment` on WorldEvent, StartTime fallback Check: Contract test green; no adapter imports asset code.
9. 9. Flames on the library (world) Requirement: MAT-01. Output: nativeFlameMaterials.ts drops its shaders; prepareNativeFlameGraph checks program.json Check: Flame acceptance passes.
10. 10. Environment program (world) Requirement: MAT-02. Output: native_environment.py and nativeEnvironmentTables.ts type every section for four types Check: Pytest through `--client`, anomalies kept.
11. 11. Lighting step (world) Requirement: MAT-02, WORLD-01. Output: The lighting `.l2asset` from `level_model.py`, `level_zones.py`, `bsp_leaf_membership.py` and VOLS; 20_20 first, then tile-general Check: Synthetic scenes pass; the 20_20 hash is pinned; every tile has a WORLD-03 pass or gap row.
12. 12. World binding (world) Requirement: MAT-02. Output: Hourly BSP lightmaps, vertex-light worker, lit terrain replacing nativeTerrainPreview, `cameraEnvironment.ts`, per-frame fog and time Check: Pixels match the CPU twins; WORLD-04 baseline recorded.
13. 13. Actors binding (actors) Requirement: MAT-01. Output: Skeletal slots with actor lights; emitters on the material.ts fragment chain; PTDS 3 and 6 flip after the swatch Check: The PTDS verdict is in `docs/parts/skills-effects/EVIDENCE.md`, and the flip commit cites it.
14. 14. Phase 3 checks Requirement: CHECK-01, CHECK-03, CHECK-04. Output: Paired captures and verdicts Check: The Phase 3 acceptance item.
15. 15. Phase 5 re-derivation Requirement: POL-04. Output: interludeEvidence from Engine.dll, Core.dll and D3DDrv.dll exports Check: The Phase 5 acceptance item.

## Open questions

- Does Interlude apply 2X to lightmaps when ModulateStaticLighting2X is false, its class default?
- Tagged Color byte order: B, G, R, A or R, G, B, A? An R != B fixture decides.
- FB_Add: which pair, and how many Interlude FinalBlends use it?
- Fog: unit 2000 or 2048? What selects the preset? View z or radial distance, vertex or table fog? Which source wins in sun-affected zones, where the reference uses zone fog only with streaming off?
- Do time tables wrap to T=0? What rule covers timeenv3 SkyBoxColor NUM=1 and the duplicate [HSVTerrainLight]?
- Terrain: shadow maps lerped or switched? Layer 0 masked? Which alpha channel per format? What does bUseAlpha change?
- Combiner: which mask channel? What do AO_Use_Mask and mask colour ops do with Mask None?
- TexRotator: yaw only or pitch, yaw and roll summed? 65535 or 65536? Phase scale? Is the serialized M only a cache?
- In Interlude, what are Jitter's random source and rate, the LT_Strobe and LT_Flicker rates, TexScaler's scale and offset order, MaterialSequence timing and loops, and VertexColor's effect?
- After the axis swap, does the camera-space env map need the (-1, 1, -1) flip?
- Interlude Engine.Shader declares NormalMap, PerformLightingOnSpecularPass and TreatAsTwoSided, which the reference ignores. How do they behave in D3D fixed function?
- Are any [S1]..[S5] glow or HDR presets on by default?
- What Brightness and Contrast do l2.ini and user.ini hold?
- Indoor sections with zero ambient: unlit white or dark?
- Are sky surfaces fogged natively? `docs/NATIVE_SKY.md:9` skips fog as browser policy.
- Foliage sway bends meshes with `sin(t * 3 / period * pi + phase)` above a pivot height (`shader-mesh-static.vs:684-696`). Which fields drive it, and which lane owns it?
- Alpha test: discard below ref, or at and below it (D3D ALPHAFUNC)?
- Native texture filtering, mip LOD bias and anisotropy (POL-04).
- When, if ever, should vertex lighting move to WebGPU compute (PERF-02)?
- Particle textures: does the frame clock run on particle age or the emitter clock? Do native Modulated particles fog toward 127/255 rather than the fog colour ([04-particles.md](04-particles.md))?
