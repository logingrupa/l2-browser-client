# Product
<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
User specified Babylon.js Editor v5 native Vanilla, strict TypeScript, pnpm, Vitest and Playwright. Vite is the native build tool.

## Users and purpose
Developers evaluating a standalone browser client foundation for later Interlude integration. The implemented Phase 1 deliverable is a working synthetic scene with a replaceable world adapter. The next local art exercise validates and integrates existing converted character assets.

## Capabilities and constraints
Exactly six initial characters, animation, interpolation, camera, targeting and lifecycle demonstrations. Static environment stays editable in Babylon.js Editor. The published foundation uses procedural characters. Converted local models are candidates for technical inspection and local integration; geometry, skinning, animation and runtime correctness determine technical usability. Preserve provenance separately from that assessment. Networking, progression and deployment are absent from Phase 1.

The asset structure guides the client implementation. Preserve the original character-part, equipment, skeleton, attachment, material and animation relationships represented by the supplied files and manifests. Adapt loaders, assembly rules, animation mapping and unit handling to that evidence; valid content must not be renamed, flattened, rebaked or uniformly resized to satisfy prototype assumptions. Conversion changes require a demonstrated defect or loss of required source structure. Keep asset resolution separate from the world adapter and future networking.

## Interface commitment
The user selected a game-like scene with compact controls. Diagnostics and demonstration controls remain visible. All entity data is synthetic.

Mobile first. The user supplied a classic fantasy HUD reference: dark translucent panels, bronze borders, top-left health and bottom action controls. Preserve the original touch-friendly interface and do not copy reference screenshot pixels. Show actual screenshots at visible implementation milestones.

## Current documentation and asset work

The user's request to fix stale files refers to **Markdown (.md)**, not stylesheets. Keep implementation claims and verification records current as assets are integrated. The asset follow-up scope is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Phase 2

**Real M0 networking**, still planned: establish Interlude authentication, character selection and world entry against stock Mobius. Preserve `GameWorldAdapter` as the future integration boundary. The asset follow-up remains synthetic and does not implement or complete Phase 2.
