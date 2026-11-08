# Native texture products

The raw migration keeps editable PNG previews, original native texture exports,
palette data and every authored mip. For supported DXT1 and DXT5 textures it also
wraps the original compressed blocks in DDS. It does not recompress pixels,
generate missing mip levels or choose native material blending rules.

## Runtime use

DDS export and the isolated upload probe below are pipeline and diagnostic
evidence. The native terrain and flame material paths decode source data and
upload RGBA `RawTexture` resources. A retained DDS derivative does not mean the
world uses GPU compressed textures. No memory or frame-time gain is established.

[RENDERING.md](RENDERING.md) covers capability-based compressed-texture
integration, color, alpha and mip handling, and residency measurement. Keep the
original mips and blocks and the partial-chain limits below when adding that path.

## Products

Texture archives come from `pnpm assets:migrate`; see
[NATIVE_MIGRATION.md](NATIVE_MIGRATION.md) for the command and receipts.

Each texture archive names `texture.png` as its primary preview. Its `asset.json`
file inventory and `provenance.json` list every retained product. DXT1 and DXT5
archives also list their DDS in `image.derivatives`, with the declared format
checked against the native source and the DDS FourCC.

| Product | Purpose |
| --- | --- |
| `texture.png` | Pinned UModel's editable mip-0 preview; unchanged by DDS generation |
| `native-texture-source.json` | Native identity, package and export hashes, offsets, property tags, mip dimensions and exact payload hashes |
| `native/texture-export.bin` | Complete native texture export, including material serialization |
| `native/mipNN.bin` | Each original mip payload in source order |
| `native/palette-export.bin`, `native/palette.rgba` | Exact same-package palette when present, including entry-zero alpha |
| `texture.dds` | Legacy DDS header followed by the original DXT1 or DXT5 mip blocks |
| `native-texture-dds.json` | Source manifest and hash, per-mip DDS offsets, hashes and consumer limits |

## Reader

The source reader supports UE123 licensee 20, 28 and 30 DXT1, DXT5 and P8
layouts. Licensee 30 adds a material prefix; its fields, opaque blocks and
encoded strings are kept without reading them as Babylon shaders. Other layouts
are explicit unsupported cases. An omitted texture Format requires the pinned
Engine class-default dependency. Malformed supported input fails conversion; it
never becomes a coverage gap.

API:

- `scripts/native_assets_lib/texture_mips.py` reads native source data.
- `scripts/native_assets_lib/texture_dds.py` provides the filesystem-independent `build_texture_dds(native_metadata, native_files)`.
- `scripts/native_texture_validation.py` rebuilds expected derivative bytes from the retained source and rejects mismatches, even when a derivative's own hashes were rewritten.

Cache keys include converter and helper hashes and source dependencies.

## Standalone scope

The standalone regression scope is 26 textures and 141 native mips (4,458,013
payload bytes). Twenty-three DXT1 textures hold 134 mips (4,194,504 bytes); their
DDS containers total 4,197,448 bytes. The other three textures are P8:
`T_20_20.Height.20_20_C`, `Engine.S_Emitter` and `Engine.DefaultTexture`. Their
native indices, palettes and PNGs stay available; no lossy compressed derivative
is made for them. This is bounded recipe coverage, not all installed-client
textures and not textures embedded in model GLBs.

## DXT5 flame glow

`FX_E_T.Flameset.de_fire_glow` is checked against exact source data and pinned
UEViewer declarations. It keeps **seven authored mips / 10,944 block bytes**,
ending at **1x2**, inside an **11,072-byte DDS**. No 1x1 level is invented. The
DDS sits inside the flame model archive, which holds **250 entries / 247
native-material files** within the 256/248 limits and **17 DDS textures**. Native
P8 stays separate.

This candidate lives in `artifacts/native-parity/migration-dxt5/` and is not
runtime-staged. Flame rendering uses its own runtime path; see
[NATIVE_FLAMES.md](NATIVE_FLAMES.md). Evidence:
`artifacts/native-parity/research/flame-runtime/texture-dxt5/README.md`.

## Babylon 9.27.1 limits

The pinned Babylon DDS loader accepts the glow and uploads exact mip 0 with
compressed format 33779. For this incomplete chain it uploads only mip 0; all
seven levels stay in the DDS. This is a loader-contract check with a recording
engine, not a GPU or native appearance test.

- S3TC (BC1 or BC3) support is required for the matching DDS. The PNG stays the inspector default; game materials do not switch to compressed textures.
- The loader uploads complete authored chains. For partial chains it uploads mip 0 only; all authored levels stay in the DDS. The standalone scope has 11 complete DXT1 chains and 12 partial chains.
- The loader selects RGBA DXT1. Native opaque versus one-bit-alpha reading, color space, orientation, filtering and blending need material-specific validation.
- A legal single-block DXT1 DDS can be 136 bytes. The pinned parser always reads a 140-byte header view and rejects such files. Metadata records this consumer limit; the exporter adds no fake mip payload or padding. A single DXT5 block makes a 144-byte DDS and passes that check.

The parser and upload tests use the pinned Babylon code. They do not establish
native visual parity, GPU compatibility on every device or performance gains. The
evidence index is [VERIFICATION.md](VERIFICATION.md). The native map inspector
keeps its neutral terrain material.

Local evidence: `artifacts/native-parity/research/terrain-materials/LICENSEE30_READER.md`
and `artifacts/native-parity/research/compressed-textures/README.md`.

## Open

- Model GLB embedded textures are still PNG derivatives. Native mip and DDS preservation covers only the standalone texture archives (PERF-02 for compression, CONV-02 for source preservation).
- General P8 GPU compression and mobile transcoding are not implemented (PERF-02).
- Capability-based GPU compressed textures with measured residency (PERF-02).
- DXT3 and other unsupported layouts (WORLD-01, CONV-02).
- Native sampling, color space and terrain blends (POL-04).
