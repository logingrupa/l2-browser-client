---
name: L2 Browser Client
description: A compact, mobile-first fantasy HUD for the Lineage II browser client sandbox.
colors:
  primary: "#edcd88"
  bronze: "#a58c59"
  panel: "rgb(24 28 26 / 94%)"
  border: "rgb(191 167 111 / 55%)"
  backdrop: "#202522"
  text: "#f5ecd8"
  muted: "#d0c6af"
  button: "#303b35"
  attack: "#654430"
  hover: "#4b574a"
  pressed: "#79704a"
  health-player: "#a33d2e"
  health-friendly: "#87bea4"
  health-monster: "#d59472"
  focus: "#ffe0a3"
  label-backing: "rgb(24 28 26 / 80%)"
typography:
  display:
    fontFamily: "Cormorant Garamond Variable, Georgia, serif"
    fontSize: "23px"
    fontWeight: 600
    lineHeight: 0.95
  display-wide:
    fontFamily: "Cormorant Garamond Variable, Georgia, serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 0.95
  player-title:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  body:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    lineHeight: 1.5
  action:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
  metadata:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "10px"
  diagnostics:
    fontFamily: "ui-monospace, Consolas, monospace"
    fontSize: "11px"
    lineHeight: 1.5
rounded:
  square: "0px"
spacing:
  compact: "4px"
  action: "5px"
  inset: "6px"
  group: "8px"
  panel: "12px"
  separation: "14px"
components:
  button-attack:
    backgroundColor: "{colors.attack}"
    textColor: "{colors.text}"
    typography: "{typography.action}"
    rounded: "{rounded.square}"
    padding: "{spacing.action}"
  button-action:
    backgroundColor: "{colors.button}"
    textColor: "{colors.text}"
    typography: "{typography.action}"
    rounded: "{rounded.square}"
    padding: "{spacing.action}"
  button-action-hover:
    backgroundColor: "{colors.hover}"
  button-action-active:
    backgroundColor: "{colors.pressed}"
  button-utility:
    backgroundColor: "{colors.button}"
    textColor: "{colors.text}"
    rounded: "{rounded.square}"
    padding: "{spacing.group}"
  target-strip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.square}"
    padding: "8px 12px"
  entity-name:
    backgroundColor: "{colors.label-backing}"
    textColor: "{colors.text}"
    rounded: "{rounded.square}"
    padding: "1px 4px"
  player-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.square}"
    padding: "6px 8px 6px 4px"
  demo-disclosure:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.primary}"
    rounded: "{rounded.square}"
    padding: "13px 14px"
---

# Design system: L2 Browser Client

## Overview

**Creative North Star: "The Classic Fantasy HUD"**

The classic fantasy HUD frames a playable 3D world with bronze hairlines, green-charcoal panels, and warm ivory lettering. Controls remain compact and familiar, with touch-sized actions and clear targeting feedback. The scene supplies the dimensional content; the interface supplies readable state.

Cormorant Garamond gives location names their fantasy character, while ordinary sans-serif labels keep actions and health understandable. The HUD uses original geometry and authored SVG icons. It does not reproduce pixels, proprietary artwork, or simulated metal textures from the reference, and it uses no decorative raster assets.

**Key Characteristics:**

- Flat dark panels with bronze borders.
- Warm serif location titles and practical sans-serif controls.
- Touch-sized actions with compact supporting measurements.
- Selection expressed by name emphasis, target details, and a ring in the world.

This record reflects `src/style.css`, `src/ui/worldStyles.ts`, and `src/ui/WorldInterface.ts`, reviewed against the desktop and compact portrait captures in [docs/screenshots/README.md](docs/screenshots/README.md). The machine-readable tokens above are normative. The companion sidecar `.impeccable/design.json` holds synthesized tonal ramps; they are preview aids, not additional runtime palette tokens.

The HUD keeps this direction while converted assets enter the sandbox. Converted parts need their own visible review against L2.exe. Work order and status are in [.planning/ROADMAP.md](.planning/ROADMAP.md) and [.planning/STATE.md](.planning/STATE.md). Stage A (Phases 1 to 3) converts the client into the offline sandbox. Networking is stage B (Phase 4).

## Direction

The user pinned this direction: a classic Lineage II HUD reference, mobile first. It overrides the design skill's random pick (seed:f8067ac85ba6da9a).

- Mode: operate. The primary task is inspecting and interacting with a 3D world.
- Health sits at the upper left; touch-sized actions sit at the bottom.
- The primary phone layout is the iPhone 15 Pro Max in landscape, 932 x 430. Portrait 430 x 932 must still fit without horizontal scroll.
- The reference's small desktop controls become touch targets of at least 44px.
- Selection joins a ground ring to the name and the target strip.
- Bronze hairlines, deep green-charcoal panels, warm ivory text, Cormorant Garamond headings, and ordinary sans-serif controls. Dense information, restrained chrome.

## Colors

Warm highlights sit on a subdued green-charcoal foundation; health colors carry state rather than decoration.

### Primary

- **Pale Gold** (`primary`): action icon strokes, target label, disclosure label, and hover border.
- **Weathered Bronze** (`bronze`, `border`): thin panel edges and themed scrollbars. The border token preserves the implementation's translucency.

### Secondary

- **Fired Umber** (`attack`): distinguishes the attack action within the shared action grid.
- **Player Red**, **Friendly Sage**, and **Monster Copper** (`health-player`, `health-friendly`, `health-monster`): local health and floating health bars.
- **Focus Gold** (`focus`): the keyboard focus outline.

### Neutral

- **Green Charcoal** (`backdrop`, `panel`, `label-backing`): browser background, HUD surfaces, and the denser local backing directly behind names.
- **Warm Ivory** and **Muted Parchment** (`text`, `muted`): primary and supporting labels.
- **Deep Moss**, **Raised Moss**, and **Pressed Olive** (`button`, `hover`, `pressed`): action states.

**The Readable Overlay Rule.** Text above the moving scene receives a stable dark backing or a soft text shadow; selection remains visible without relying on color alone.

## Typography

**Display Font:** Cormorant Garamond Variable, with Georgia and serif fallbacks; the browser self-hosts its Latin variable font.

**Body Font:** Segoe UI, system-ui, sans-serif.

**Measurement Font:** ui-monospace, Consolas, monospace.

The display face provides a narrow, high-contrast serif voice without making buttons ornate. Supporting typography stays compact because it labels a full-screen world rather than carrying long-form reading.

### Hierarchy

- **Location title:** the `display` role changes to `display-wide` at the wide breakpoint; headings use balanced wrapping.
- **Player identity:** the `player-title` role expands to 15px at the wide breakpoint.
- **Target identity:** 13px at weight 500, with supporting health and target labels in the metadata scale.
- **Instructions:** the `body` role is reserved for short help paragraphs inside the disclosure.
- **Action labels:** the `action` role accompanies original line icons.
- **Metadata:** the `metadata` role is for brief adjacent information, not long instructions.
- **Diagnostics:** the `diagnostics` role uses tabular numerals.

**The Measured Type Rule.** Reserve monospace and tabular numerals for FPS, entity count, and coordinates.

## Layout

The HUD overlays the rendering canvas and follows its bounds. It uses pointer-transparent framing with pointer-enabled controls and entity labels. The primary compact layout has safe-area-aware top/bottom spacing and 12px horizontal insets.

The header separates player information from location identity. The target strip centers beneath it and wraps if necessary. Five equal action columns sit in a bordered bottom panel, with diagnostics and a concise status above and secondary controls in a disclosure below.

At 760px and wider, the outer inset becomes 22px vertically and 26px horizontally, the player panel grows from 180px to 225px, and the bottom control group narrows to 420px. Portrait controls can use up to 500px. A short landscape layout below 500px height places a 360px control group at the right, reduces action height to the 44px touch minimum, and hides the status line. These are observed HUD adaptations, not a global page-layout prescription.

## Elevation and depth

Panels have thin borders and translucent dark fills; there are no panel box shadows. Depth belongs to the Babylon scene and its real perspective. Soft text shadows preserve legibility over changing scenery: location text uses a downward 2px offset with 4px blur; diagnostics use a 1px offset with 3px blur; names combine small soft offsets over a dark backing.

**The Scene Depth Rule.** Let the rendered world provide depth. HUD panels remain flat, separated by thin borders rather than decorative bevels or large shadows.

## Shapes

The HUD uses square corners and single-pixel borders. Original line icons share rounded stroke caps and joins, a 1.5px stroke, and 24px action silhouettes. The player emblem is a simple outlined geometric mark. The selection ring is a runtime 3D torus; it is not a CSS progress indicator.

## Components

### Action buttons

Compact squares pair a drawn icon with a plain action label. Attack uses Fired Umber; other actions use Deep Moss. Standard action height is at least 59px and becomes at least 44px in short landscape layouts. Hover changes the fill and border; active state uses Pressed Olive. Color transitions last 120ms with ease-out. Reduced-motion preferences remove those transitions.

### Utility buttons and disclosure

Secondary controls use plain text, the same square frame, and at least 44px height. Disabled controls reduce opacity to 45% and lose the pointer cursor. The disclosure keeps secondary commands available without covering the initial scene; its scrollable content is capped at 27dvh on compact screens and 220px on wide screens.

### Target strip

A small flat panel places the Target label, selected name, and health on one wrapping baseline. Its empty state explains how to select. The label is functional field metadata beside the value, not a heading eyebrow.

### Floating character labels

Each name is an accessible button with at least 44px height and 70px width. A tight dark backing sits immediately behind the visible text, with a thin health meter below. Selection adds underline and warm emphasis; the 3D selection ring supplies a second signal. Labels project from the character and hide outside the viewport.

### Player panel

A geometric emblem sits beside the local player's identity, a red health bar with numeric values, and the synthetic-world label. Numeric and bar values update together. The panel remains compact and retains a distinct health hierarchy rather than becoming a general-purpose card.

### Focus and status

Controls use a 2px Focus Gold outline with 3px offset. The short status message uses a dark backing and a live region. Initial loading and startup failures use a clear text panel. There are no text-entry fields or primary navigation components in this phase.

## Do's and don'ts

### Do:

- **Do** preserve the bronze, green-charcoal, and warm ivory relationship.
- **Do** retain at least 44px-high interactive controls and visible keyboard focus.
- **Do** pair icons with action labels and keep synthetic data identified.
- **Do** keep entity names readable against changes in the 3D background.

### Don't:

- **Don't** copy proprietary game artwork or reference screenshot pixels.
- **Don't** replace measured diagnostics with decorative charts or marketing statistics.
- **Don't** use a serif display face for dense instructions or numeric diagnostics.
- **Don't** add decorative material effects that compete with the rendered scene.

## Open

- Native windows built from decoded `interface.xdat` layouts (UI-01, UI-02) versus these mobile-first tokens (UI-03): the skin approach is unsettled. It is settled when Phase 2 UI is planned; see [.planning/STATE.md](.planning/STATE.md).
