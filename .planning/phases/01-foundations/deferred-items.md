# Phase 1 deferred items

Out-of-scope issues found while executing plans. Not fixed by the plan that found them.

## From plan 01-02

- `tests/pipeline/test_native_animation_aliases.py` `RealReportTests.test_refuses_to_overwrite_a_different_output` errors in this worktree with `FileNotFoundError` for `artifacts/native-parity/inputs/IMPORTA-PC/system/LineageWarrior.int`. The class has no skip guard for that private input, which exists only in the main checkout. It fails the same way at e97db7d, before plan 01-02, so `pnpm test:pipeline` exits 1 here for a reason unrelated to the guard (806 run, 1 error, 103 skipped). Fix: add the same private-input `skipUnless` the other pipeline tests use.
- Remaining `--client` entry points are wired to the guard in plans 01-07 and 01-08, as planned. Those plans guard entry points only. The internal readers `native_catalog/effects.py` `read_class_defaults` and `SourcePackages` (also called from `Converter`), and UModel's own `-path=<client>` package reads in `Converter.run`, still open client files without a per-file `require_equal_file` check. Entry-point guards still refuse E: while the lock is missing. Once the lock exists, a per-file check for these readers needs an owner plan.
