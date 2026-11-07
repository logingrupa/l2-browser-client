# tools/README.md investigation

Scope: the complete 482-line catalog at upstream commit
`12c9656e2f053b233ec3fd87056491a6a6da8b0c`, considered as one documentation
entry. All upstream references below are relative to that checkout.

The catalog groups source decoding/export, native instruction verifiers,
offline browser inspections, controlled live playtests and regression commands
(`tools/README.md:175`, `:286`, `:377`, `:387`). Its most useful maturity
statement is the opening distinction between a repository toolkit and complete
client compatibility (`:3`). The standalone Core allowlist, changing source
builds versus unchanged published ZIPs, and NPC Source kit are explicitly
distinguished (`:5`, `:10`, `:160`). Portable fixtures prove bounded behavior;
owned binaries, matching converted data and selected native dependencies remain
separate inputs (`:162`, `:169`). Browser pages ordinarily replay supplied state
offline; online play uses an explicitly supplied identity and produces private
receipts (`:290`, `:360`, `:379`). Historical visual suites are explicitly
unsupported because their oracles were wrong (`:433`), a useful safeguard against
inflated maturity claims.

Three command targets substantiate—and qualify—the documentation.
`tools/uscript/extract_uscript.py:106` implements `--check`, requires the local
decryptor and original packages, and returns before writing extracted scripts
at `:136`. `tools/xdat/parse_xdat.py:664` exposes configurable source/output
paths, rejects a missing original, then joins records against the repository
texture library (`:688`): a documented decoder is not automatically an isolated
pipeline. `tools/audio/export_quest_sounds.py:28` compares exact WAV and metadata
bytes in check mode, but `main` still writes a receipt (`:68`). Therefore
`--check` means output-specific verification, not a universal filesystem
read-only guarantee. None of these source checks establishes rendered
appearance, audio playback equivalence or integrated gameplay.

Verdict: **adapt the documentation contract; reference the catalog rather than
copying its commands wholesale**. Local `scripts/native_assets.py:113`
(`verify_archive`) already verifies product hashes, and conversion cache reuse
at `:543` already returns verified archives. Existing upstream reuse is pinned
in `scripts/vendor/lineage2elbera_bsp/SOURCE.json:3`; another tool framework or
duplicate wrapper would obscure that work. The catalog's stable-entry-point
rule (`tools/README.md:451`) instead supports documenting current local commands
with source edition/hash, inputs, writes, exact proof, unsupported paths and
portable/private/live requirements. Local `docs/ASSET_PIPELINE.md:461` already
documents dependency and product verification; extend its index rather than
creating a competing pipeline guide.

Smallest useful follow-up: add this contract to three existing local command
entries, with acceptance that every command resolves to an implementation and
each claim names its evidence level. MIT covers upstream authored code and
documentation with notice retention (`LICENSE:3`, `:12`); game assets, aCis and
listed vendored components are explicitly separate (`LICENSE:25`). This review
executed only text/file inspection and report creation: no suites, native
binaries, servers, private exports or release builds were run.
