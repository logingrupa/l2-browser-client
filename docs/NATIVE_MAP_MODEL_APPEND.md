# Add one source-qualified map model

The section now contains **157 static placements / 62 model identities**, plus
the existing BSP floor and sky. `20_20.StaticMeshActor3703` uses
`Dion_tree_S.red_mt.dion_excute_tree1`. Eight indexed triangles cross the retained
section rectangle. The full tree stays at its original transform; it is not
clipped, resized or moved to hide the edge of the bounded terrain import.

The bounds scout screened all 193 previously unavailable model identities and
1,794 outside-origin actors. One candidate survived bounds and indexed-triangle
checks. This is not complete geometry/material support for all 193 identities;
103 licensee-12 cases retain bounds-only limitations.

## Reproduce using retained inputs

Run from the project directory with Editor Play stopped. These commands use
existing pinned outputs and the read-only local IMPORTA snapshot. Do not run a
full reimport over authored work. See the linked reports for the original
conversion, source-normal restoration and single-model Babylon capture commands.

```powershell
python scripts/derive-native-map-model.py --archive artifacts/native-parity/research/map-overlap-expansion-20261106/source-normal-correction/derived/4a800ae694cbf210835e14a3684763de8c0bc3258bdbce316f0bb7bda995ded3/asset.l2asset --sha256 4a800ae694cbf210835e14a3684763de8c0bc3258bdbce316f0bb7bda995ded3 --output artifacts/native-parity/research/map-overlap-expansion-20261106/tree-integration/runtime --stage
node scripts/append-native-editor-model.mjs --snapshot artifacts/native-parity/research/map-overlap-expansion-20261106/tree-integration/editor-snapshot.json --snapshot-sha256 fb73191b2059d72a3d959ec176b23541fe44e9642fc7eaf64b2a6bc297ceb849 --manifest artifacts/native-parity/research/map-overlap-expansion-20261106/tree-integration/runtime/bundle/map-section-runtime/manifest.json --sha256 e006306d2ab0d47f5c001cdaf8be91e507af9c20abcb8011cfced5aa59f7d540 --apply
pnpm build
```

Omit `--stage` to prepare source data only, or `--apply` to plan the Editor append.
The guarded commands reject conflicting source identities, unsupported graph
changes and overwrites. Both repeated applied operations make no changes and
preserve subsequent authored edits. `pnpm build` includes the existing UV2
preservation step; raw Editor Play export still has its documented UV2 limit.
An already-open Editor needs a normal scene/project reopen to read added files.
This checkpoint validates saved data, CLI export and browser use; it does not
claim a new interactive Editor save.

## Exact repair and preservation

The native source demonstrates incorrect converted normals. The narrow repair
restores 533 original normals: 1,599 float fields / 4,120 differing GLB bytes,
without normalization. Every other GLB byte is unchanged. It preserves native
positions, UVs, indices, material assignments and three original embedded PNGs.
The repair admits only the qualified source layout; it does not broaden native
format support by guessing.

The additive Editor operation creates two nodes, four mesh records, three
geometry binaries and three PNGs. Only the existing world manifest and matching
config/channel-proof manifest identities change. Across 2,297 baseline files,
2,292 remain byte-identical; the other two expected changes are the public
catalog and generated export cache. No existing geometry, material or authored
placement was replaced. Original binaries, corrected terrain primary UVs and
diffuse UV2 remain exact in saved/public/dist outputs.

## Evidence and remaining scope

The [integration report](../artifacts/native-parity/research/map-overlap-expansion-20261106/tree-integration/REPORT.md)
links four matched before/after desktop/mobile captures, source and authored
browser checks, exact geometry-channel comparisons, hashes and repeat receipts.
The prepared derivative passes five pipeline tests; normal restoration passes
eight; 75 relevant unit checks, four browser regressions and build/typecheck pass.

This establishes source-backed placement and preserved conversion data, not
native visible-pixel parity. Native tree lighting, alpha/culling semantics,
collision and the surrounding unimported terrain remain open. The existing sky
color boundary and original audio acceptance remain unresolved. FPS screenshots
are diagnostics, not performance benchmarks. No native action, service change
or deployment accompanied this work. The earlier 74-file terrain packet remains
unreviewed; this addition does not adopt its unresolved rendering assumptions.
