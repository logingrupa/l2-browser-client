# Native texture products

The raw migration preserves editable PNG previews, original native texture exports,
palette data and every authored mip. For supported DXT1 and DXT5 textures it additionally
wraps the original compressed blocks in DDS. It does not recompress pixels,
generate missing mip levels or choose native material blending rules.

## Application status — 2026-11-07

Compressed DDS export and the isolated upload probe below are pipeline/diagnostic
evidence. The current native terrain and flame material paths decode source data
and upload RGBA `RawTexture` resources; a retained DDS derivative does not mean
the world uses GPU compressed textures. No application memory or frame-time gain
is established by these exports.

[RENDERING.md](RENDERING.md) includes capability-based compressed-texture
integration, correct color/alpha/mip handling and actual residency measurements.
Preserve original mips/blocks and the documented partial-chain limits while
adding that runtime path.

## Migration and retained products

Run from the existing project:

```powershell
pnpm assets:migrate --output artifacts/native-parity/migration-dxt5 --prove-rebuild
pnpm test:pipeline --migration-output artifacts/native-parity/migration-dxt5
```

Each texture archive identifies `texture.png` as its primary preview. Its
`asset.json` file inventory and `provenance.json` identify all retained products.
Supported DXT1 and DXT5 archives also list their DDS in `image.derivatives`,
with the declared format checked against the native source and DDS FourCC.

| Product | Purpose |
| --- | --- |
| `texture.png` | Pinned UModel's editable mip-0 preview; unchanged by DDS generation |
| `native-texture-source.json` | Native identity, package/export hashes, offsets, property tags, mip dimensions and exact payload hashes |
| `native/texture-export.bin` | Complete native texture export, including material serialization |
| `native/mipNN.bin` | Each original mip payload in source order |
| `native/palette-export.bin`, `native/palette.rgba` | Exact same-package palette when present, including entry-zero alpha |
| `texture.dds` | Legacy DDS header followed by original DXT1 or DXT5 mip blocks |
| `native-texture-dds.json` | Source manifest/hash, per-mip DDS offsets, hashes and consumer limitations |

The source reader supports reviewed UE123/licensee20,28,30 DXT1/DXT5/P8 layouts.
Licensee30 contains an additional material prefix; its fields, opaque blocks and
encoded strings are preserved without interpreting them as Babylon shaders.
Other layouts remain explicit unsupported cases. Omitted texture Format requires
the pinned Engine class-default dependency. Malformed supported inputs fail
conversion rather than becoming coverage gaps.

The retained standalone reader regression scope comprises 26 textures and 141 native mips
(4,458,013 payload bytes). Twenty-three DXT1 textures contain 134 mips
(4,194,504 bytes); their DDS containers total 4,197,448 bytes. The remaining three
textures are P8: `T_20_20.Height.20_20_C`, `Engine.S_Emitter` and
`Engine.DefaultTexture`. Their native indices/palettes and PNGs remain available;
no lossy compressed derivative is invented for them. This is bounded recipe
coverage, not coverage of all installed-client textures or textures embedded in
model GLBs.

`scripts/native_assets_lib/texture_mips.py` reads native source data.
`scripts/native_assets_lib/texture_dds.py` provides the filesystem-independent
`build_texture_dds(native_metadata, native_files)` API. Migration's
`scripts/native_texture_validation.py` reconstructs expected derivative bytes from
the retained source and rejects mismatches even if a derivative's own hashes were
rewritten. Cache keys include converter/helper hashes and source dependencies.

## DXT5 glow proof — 2026-11-05

The later DXT5 extension is verified against exact
`FX_E_T.Flameset.de_fire_glow` source data and pinned UEViewer declarations.
It preserves **seven authored mips / 10,944 block bytes**, ending at **1×2**,
inside an **11,072-byte DDS**. It does not invent the missing 1×1 level.
The existing 26-texture / 141-mip standalone scope above remains unchanged;
the separate migration candidate adds this DDS inside the existing flame model
archive. That archive retains **17 DDS textures**, with native P8 still separate,
and has **250 entries / 247 native-material files** within unchanged 256/248 limits.

`pnpm assets:migrate --output artifacts/native-parity/migration-dxt5 --prove-rebuild`
passed **381 identical products**, **26/26 cache hits**, zero clean hits and
**100 valid archives**, rebuilding from the initially empty
`migration-clean-261bn7jd/`. All **69 model GLBs and terrain GLB** equal their
preceding versions; **2,245 authored files / 53,609,808 bytes** are unchanged.
`pnpm test:pipeline --migration-output artifacts/native-parity/migration-dxt5`
passed **313 tests**, with zero skips. The optional test argument selects that
validated output without replacing the currently staged/Editor world. The
initial run against the older default fixture correctly rejected its stale
converter fingerprint; the rejection remains in `pipeline-all.log`.
The passing run is retained in `pipeline-current.log`. Both logs and
`migration-glb-preservation.json` / `authored-preservation.json` are under
`artifacts/native-parity/research/flame-runtime/texture-dxt5/`; full receipts
are `artifacts/native-parity/migration-dxt5/{reproducibility,validation}.json`.

The isolated proof's standalone glow archive also declares DXT5 consistently with its native
format, DDS sidecar and FourCC. All **257 existing source/DDS files** remain
byte-identical; three P8 coverage messages intentionally change to describe
their unsupported format accurately. Converter fingerprints and archives
therefore acquire new identities. Evidence and repeatable isolated proof:
`artifacts/native-parity/research/flame-runtime/texture-dxt5/README.md`.

The default `migration/`, `public/l2` manifests and saved authored scene retain
their preceding snapshot. This candidate was not runtime-staged. Flame runtime
integration and native visual acceptance remain pending; preservation and
focused material/clock tests do not establish a native visual pass.

## Babylon 9.27.1 limits

The actual pinned Babylon DDS loader accepts the glow and uploads exact mip0
using compressed format 33779. It uploads only mip0 for this incomplete chain;
all seven levels remain available in the DDS. This is a loader-contract check
with a recording engine, not a physical GPU or native appearance test.

- S3TC/BC1 or BC3 support is required for the respective DDS. The PNG remains the existing inspector's default;
  this change does not switch game materials to compressed textures.
- The standard DDS loader uploads complete authored chains. For partial chains
  it uploads mip 0 only; all authored levels remain in the DDS. The current scope
  has 11 complete DXT1 chains and 12 partial chains.
- The loader selects RGBA DXT1. Native opaque versus one-bit-alpha interpretation,
  color space, orientation, filtering and blending need material-specific validation.
- A legal single-block DXT1 DDS can be 136 bytes. The pinned Babylon parser attempts
  an unconditional 140-byte header view and rejects such files. Metadata records
  this consumer limit; the exporter does not add fabricated mip payloads or padding.
  A single DXT5 block produces a 144-byte DDS and passes that header-size check.

The parser/upload-contract tests use the actual pinned Babylon code. They do not
establish native visual parity, GPU compatibility on every device or performance
gains. Browser evidence and exact check counts belong in [VERIFICATION.md](VERIFICATION.md).
Native sampling and terrain blends remain unverified; the native map inspector
retains its neutral terrain material.

Local evidence: `artifacts/native-parity/research/terrain-materials/LICENSEE30_READER.md`
and `artifacts/native-parity/research/compressed-textures/README.md`.
