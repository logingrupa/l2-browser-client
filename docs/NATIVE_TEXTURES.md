# Native textures

What a texture archive keeps and what the runtime uses. Native mips, palettes and DXT blocks stay byte-exact; the world still uploads decoded RGBA. Decisions and work order: [PROJECT.md](../.planning/PROJECT.md), [ROADMAP.md](../.planning/ROADMAP.md).

## Now

- `assets:convert --kind texture` and `assets:migrate` write archives. `scripts/native_assets_lib/texture_mips.py` reads UE2 118/0 and UE123 licensee 0, 16, 18, 20, 23, 25, 27, 28 and 30 in P8, DXT1 and DXT5, each pair with an exact Elbera mip row in `tests/fixtures/texture-layouts/cross-checks.json`; other layouts and formats record `nativeTextureSource.status = unsupported` with `gapReason` `texture-licensee-unsupported:<v>/<lic>` or `texture-format-unsupported:<format>`. No recompression or generated mips.
- Files: `texture.png` (mip-0 preview), `native-texture-source.json`, `native/texture-export.bin`, `native/mipNN.bin`, and `native/palette-export.bin` plus `native/palette.rgba` when a palette exists. DXT1 and DXT5 add `texture.dds` (original blocks) and `native-texture-dds.json` under `image.derivatives`. Model archives with `materialPolicy: preserve-native-graph` keep these files under `native-materials/textures/<identity>/`.
- `scripts/native_assets_lib/texture_dds.py` writes the DDS; `scripts/native_texture_validation.py` rebuilds it from source and rejects a mismatch.
- Terrain and flame materials upload decoded RGBA `RawTexture`. No DDS gain is measured.
- Babylon 9.27.1 DDS loader needs S3TC, uploads only mip 0 of a partial chain, and rejects a legal 136-byte DXT1 DDS. No padding is added.
- `tests/browser/nativeTexture.spec.ts` checks DDS upload, not native parity or GPU coverage; skips without migration output.
- 23 DXT1 textures / 134 mips are byte-exact in their DDS: `artifacts/native-parity/research/compressed-textures/`, rated in [research/INDEX.md](research/INDEX.md).
- DXT5 flame glow `FX_E_T.Flameset.de_fire_glow` keeps seven mips ending at 1x2, no invented 1x1, in unstaged `artifacts/native-parity/migration-dxt5/` (`artifacts/native-parity/research/flame-runtime/texture-dxt5/README.md`).

## Open

- Textures inside model GLBs are PNG derivatives; only texture archives and `preserve-native-graph` model archives keep native mips and DDS (CONV-02, PERF-02).
- GPU compressed textures with measured residency, P8 compression, mobile transcoding (PERF-02).
- DXT3 and other unsupported layouts (WORLD-01, CONV-02).
- Colour space and terrain layer blending: MAT-01, MAT-02. Native sampling parity and DXT1 alpha: POL-04.

## Pointers

- `src/scene/world/nativeTerrainPreview.ts`, `src/scene/world/nativeFlameMaterials.ts`.
- [NATIVE_MIGRATION.md](NATIVE_MIGRATION.md), [RENDERING.md](RENDERING.md), [NATIVE_FLAMES.md](NATIVE_FLAMES.md).
