# Foundation captures

This folder tracks two images of the procedural foundation HUD. [README.md](../../README.md) embeds `mobile.png`.

- `mobile.png` (390 x 844): the primary portrait layout.
- `desktop.png` (1440 x 900): the wide layout.

Both are Playwright screenshots taken on 2026-11-04. The six-entity world is paused and Elyra is selected. Both capture sessions recorded zero browser console errors and zero uncaught exceptions. They are software-rendered Chromium captures. They do not verify a physical device, real model loading, or native parity.

All geometry and icons in these images are original project assets. Cormorant Garamond is covered by the font notice in [../licenses/Cormorant-Garamond.txt](../licenses/Cormorant-Garamond.txt). No pixels from the user's reference screenshot are included. The HUD rules these images show are in [DESIGN.md](../../DESIGN.md).

## Converted-asset captures

Converted-asset and native captures stay in ignored `artifacts/`. Any `asset-*.png` file in this folder is also ignored. Do not commit imported artwork or captures, and do not use the foundation images as asset evidence. The evidence index is [docs/VERIFICATION.md](../VERIFICATION.md).

Capture folders with PNG, JSON diagnostics and hash manifests:

- artifacts/native-parity/browser/npc-profiles-20261105/
- artifacts/native-parity/browser/musveren-support-20261105/
- artifacts/native-parity/browser/debug-location-20261105/
- artifacts/native-parity/research/flame-runtime/hardware-browser/ (GTX 1060 desktop 1920 x 1080 and mobile touch emulation 390 x 844, FPS visible; headless capture FPS is not a sustained benchmark)

Software WebGL FPS in these sets is not a GTX 1060 or 120 FPS benchmark.
