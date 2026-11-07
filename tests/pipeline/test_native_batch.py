"""Offline batch lifecycle tests; all converter execution is a controlled fake.

Real source files, assets, UModel, browsers and completed sound corpora are never
used. Adapter-format validation belongs to test_native_batch_adapters.py.
"""
from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
FAKE_ADAPTERS = types.ModuleType('native_batch_adapters')
SPEC = importlib.util.spec_from_file_location('_native_batch_lifecycle_test_subject', ROOT / 'scripts/native_batch.py')
batch = importlib.util.module_from_spec(SPEC)
# The isolated subject retains this module after the import patch is removed;
# other suites still import the real adapters normally.
with patch.dict(sys.modules, {'native_batch_adapters': FAKE_ADAPTERS}):
    SPEC.loader.exec_module(batch)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def snapshot(root):
    return {p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns)
            for p in root.rglob('*') if p.is_file()}


class BatchLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='native-batch-lifecycle-')
        self.addCleanup(self.temporary.cleanup)
        self.project = Path(self.temporary.name)
        self.source = self.project / 'inputs/pinned'
        self.source.mkdir(parents=True)
        self.source_bytes = b'original native fixture\x00\x01'
        (self.source / 'source.bin').write_bytes(self.source_bytes)
        self.recipes = self.project / 'recipes'
        self.recipes.mkdir()
        self.lock_path = self.recipes / 'inputs.json'
        self.write_json(self.lock_path, {'schemaVersion': 1, 'sourceHost': 'fixture', 'files': [
            {'relativePath': 'source.bin', 'bytes': len(self.source_bytes), 'sha256': sha(self.source_bytes)}]})
        self.child_recipe = self.recipes / 'assets.json'
        self.write_json(self.child_recipe, [{'kind': 'model', 'object': 'Fixture.Model'}])
        self.recipe_path = self.recipes / 'batch.json'
        self.recipe = {'schemaVersion': 1, 'kind': 'native-offline-asset-batch', 'id': 'fixture-batch',
                       'sources': {'pinned': {'root': 'inputs/pinned', 'lock': 'recipes/inputs.json'}},
                       'jobs': [self.job('first')]}
        self.write_recipe()
        self.adapter_file = self.project / 'scripts/fake_adapter.py'
        self.adapter_file.parent.mkdir()
        self.adapter_file.write_text('# pinned adapter fixture\n', encoding='utf8')
        self.output = self.project / 'artifacts/batch'
        self.calls = []
        self.behaviors = {}
        self.on_execute = None
        self.pin_version = 'one'

        def validate_job(job):
            if not isinstance(job, dict) or set(job) - {'id', 'adapter', 'source', 'recipe', 'dependsOn'}:
                raise ValueError('Invalid fixture adapter request')
            if not {'id', 'adapter', 'source', 'recipe'} <= set(job) or job['adapter'] != 'assets':
                raise ValueError('Unknown fixture adapter')

        def command(job, source_root, source_lock, output, project_root=ROOT):
            # Nothing in these tests is passed to a shell or external process.
            return ['fake-converter', '--id', job['id'], '--output', str(output)]

        def collect(job, output, source_lock, project_root=ROOT):
            status = self.behaviors.get(job['id'], {}).get('status', 'converted')
            if self.behaviors.get(job['id'], {}).get('collect_error'):
                raise ValueError('Fixture product is invalid')
            if not (output / 'nested/data.bin').is_file():
                raise ValueError('Fixture product missing')
            return {'status': status, 'counts': {'fixtureModels': 1},
                    'products': ['nested/data.bin', 'fixture.json'],
                    'sourceDependencies': {'source.bin': sha(self.source_bytes)},
                    'unsupported': ['one unresolved fixture field'] if status == 'partial' else [],
                    'limits': ['Synthetic adapter boundary only; no native conversion.']}

        patches = {
            '__file__': str(self.adapter_file),
            'validate_job': validate_job,
            'recipe_paths': lambda job, project_root=ROOT: [project_root / job['recipe']],
            'adapter_pins': lambda name: {'fixture-tool': sha(self.pin_version.encode())},
            'command': command,
            'collect': collect,
        }
        for name, value in patches.items():
            patcher = patch.object(batch.adapters, name, value, create=True)
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def job(identity, depends=None):
        row = {'id': identity, 'adapter': 'assets', 'source': 'pinned', 'recipe': 'recipes/assets.json'}
        if depends is not None:
            row['dependsOn'] = depends
        return row

    @staticmethod
    def write_json(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(batch.canonical(value))

    def write_recipe(self, recipe=None, path=None):
        self.write_json(path or self.recipe_path, self.recipe if recipe is None else recipe)

    def execute(self, argv, *, cwd, stdout, stderr, shell, check):
        self.assertFalse(shell)
        self.assertFalse(check)
        self.assertEqual(Path(cwd), self.project)
        self.assertEqual(argv[0], 'fake-converter')
        identity = argv[argv.index('--id') + 1]
        self.calls.append(identity)
        behavior = self.behaviors.get(identity, {})
        if behavior.get('interrupt'):
            raise KeyboardInterrupt('Synthetic adapter interruption')
        output = Path(argv[argv.index('--output') + 1])
        (output / 'nested').mkdir(parents=True)
        (output / 'nested/data.bin').write_bytes(b'converted fixture:' + identity.encode())
        self.write_json(output / 'fixture.json', {'id': identity, 'sourceSha256': sha(self.source_bytes)})
        stdout.write(b'fixture stdout\n')
        stderr.write(b'')
        if self.on_execute:
            self.on_execute(identity)
        return types.SimpleNamespace(returncode=behavior.get('exit', 2 if behavior.get('status') == 'partial' else 0))

    def run_batch(self, output=None, recipe_path=None, **options):
        with contextlib.redirect_stdout(io.StringIO()):
            return batch.run(recipe_path or self.recipe_path, output or self.output,
                             project_root=self.project, execute=self.execute, **options)

    def test_portable_paths_reject_traversal_absolute_reserved_and_case_collision(self):
        for name in ['', '../x', 'x/../y', '/absolute', 'x//y', 'x\\y', 'C:/x', 'x:stream',
                     'NUL', 'con.txt', 'x/COM1.bin', 'x/last.', 'x/last ', 'x/\x00bad']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                batch.safe_relative(name)
        self.assertEqual(batch.safe_relative('safe/sub-file.bin'), 'safe/sub-file.bin')
        self.source.joinpath('A.bin').write_bytes(b'x')
        entries = [{'relativePath': name, 'bytes': 1, 'sha256': sha(b'x')} for name in ['A.bin', 'a.bin']]
        self.write_json(self.lock_path, {'schemaVersion': 1, 'files': entries})
        with self.assertRaisesRegex(ValueError, 'case-colliding'):
            self.run_batch(plan_only=True)
        self.assertFalse(self.output.exists())

    def test_duplicate_json_nonfinite_and_oversized_json_are_rejected(self):
        for data in [b'{"a":1,"a":2}', b'{"value":NaN}', b'{"value":Infinity}', b'{"value":-Infinity}']:
            with self.subTest(data=data):
                self.recipe_path.write_bytes(data)
                with self.assertRaises(ValueError):
                    batch.load_json(self.recipe_path)
        self.write_recipe()
        with patch.object(batch, 'MAX_JSON', 1), self.assertRaisesRegex(ValueError, 'too large'):
            batch.load_json(self.recipe_path)

    def test_plan_checks_sources_and_commands_without_creating_output(self):
        before = snapshot(self.project)
        result = self.run_batch(plan_only=True)
        self.assertEqual(result['mode'], 'plan')
        self.assertEqual(result['writes'], 0)
        self.assertFalse(self.output.exists())
        self.assertEqual(self.calls, [])
        self.assertEqual(snapshot(self.project), before)
        self.assertEqual(result['owner']['scope'], {'offline': True, 'browserStaging': False,
                                                  'editorEdits': False, 'nativeExecution': False})

    def test_invalid_job_dependencies_source_and_unknown_fields_fail_before_writes(self):
        variants = [
            [self.job('../first')], [self.job('first'), self.job('first')],
            [self.job('first', ['later']), self.job('later')], [self.job('first', ['first'])],
            [self.job('first'), self.job('second', ['first', 'first'])],
            [{**self.job('first'), 'source': 'missing'}],
            [{**self.job('first'), 'adapter': 'shell'}],
            [{**self.job('first'), 'shell': 'do something'}],
        ]
        for jobs in variants:
            with self.subTest(jobs=jobs):
                self.recipe['jobs'] = jobs
                self.write_recipe()
                with self.assertRaises(ValueError):
                    self.run_batch(plan_only=True)
                self.assertFalse(self.output.exists())
        self.assertEqual(self.calls, [])

    def test_wrong_source_hash_is_not_converted_or_reused(self):
        (self.source / 'source.bin').write_bytes(b'changed source')
        with self.assertRaisesRegex(ValueError, 'Source hash/size differs'):
            self.run_batch()
        self.assertFalse(self.output.exists())
        self.assertEqual(self.calls, [])

    def test_output_must_be_artifacts_child_and_not_overlap_sources_or_recipes(self):
        outputs = [self.project / 'public/new', self.project / 'artifacts']
        for output in outputs:
            with self.subTest(output=output), self.assertRaisesRegex(ValueError, 'artifacts subdirectory'):
                self.run_batch(output=output)
        # Move a fresh source fixture below artifacts to exercise both overlap directions.
        nested = self.project / 'artifacts/source'
        nested.mkdir(parents=True)
        (nested / 'source.bin').write_bytes(self.source_bytes)
        self.recipe['sources']['pinned']['root'] = 'artifacts/source'
        self.write_recipe()
        for output in [nested, nested / 'out']:
            with self.subTest(output=output), self.assertRaisesRegex(ValueError, 'overlaps source'):
                self.run_batch(output=output)
        nested_recipe = self.project / 'artifacts/batch/recipe.json'
        self.write_recipe(path=nested_recipe)
        with self.assertRaisesRegex(ValueError, 'overlaps batch recipe'):
            self.run_batch(recipe_path=nested_recipe)

    def test_recipe_outside_project_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix='native-batch-outside-') as other:
            other = Path(other)
            external_recipe = other / 'batch.json'
            self.write_recipe(path=external_recipe)
            with self.assertRaisesRegex(ValueError, 'inside project'):
                self.run_batch(recipe_path=external_recipe)

    def test_symlink_source_boundary_is_rejected_when_platform_allows_creation(self):
        link = self.project / 'linked-input'
        try:
            link.symlink_to(self.source, target_is_directory=True)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f'Windows symlink creation unavailable: {error}')
        self.recipe['sources']['pinned']['root'] = 'linked-input'
        self.write_recipe()
        with self.assertRaisesRegex(ValueError, 'Symlink/junction/reparse'):
            self.run_batch(plan_only=True)

    def test_existing_empty_or_nonempty_unowned_directory_and_file_are_untouched(self):
        for kind in ['empty', 'nonempty', 'file']:
            output = self.project / 'artifacts' / kind
            if kind == 'file':
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(b'unowned')
            else:
                output.mkdir(parents=True)
                if kind == 'nonempty':
                    (output / 'unowned.bin').write_bytes(b'preserve')
            before = snapshot(self.project)
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                self.run_batch(output=output)
            self.assertEqual(snapshot(self.project), before)
        self.assertEqual(self.calls, [])

    def test_clean_repeats_produce_identical_products_and_receipts(self):
        first = self.run_batch()
        second_output = self.project / 'artifacts/clean-second'
        second = self.run_batch(output=second_output)
        self.assertEqual(first['status'], 'converted')
        self.assertEqual(second['status'], 'converted')
        self.assertEqual(first['adapterExecutions'], 1)
        self.assertEqual(second['adapterExecutions'], 1)
        for name in ['owner.json', 'batch.json', 'jobs/first/nested/data.bin', 'jobs/first/fixture.json']:
            self.assertEqual((self.output / name).read_bytes(), (second_output / name).read_bytes(), name)
        result = first['jobs'][0]
        self.assertEqual(result['coverage']['conversion'], 'converted')
        self.assertEqual(result['coverage']['productIntegrity'], 'verified')
        self.assertEqual(result['coverage']['browserStaging'], 'not-requested')
        self.assertEqual(result['coverage']['runtimeIntegration'], 'not-evaluated')
        self.assertEqual(result['coverage']['nativeParity'], 'unverified')

    def test_repeat_and_verify_are_write_free_without_executing_or_collecting_again(self):
        self.run_batch()
        before = snapshot(self.project)
        self.calls.clear()
        with patch.object(batch.adapters, 'collect', side_effect=AssertionError('Must not rerun collector')):
            repeated = self.run_batch()
            verified = self.run_batch(verify_only=True)
        self.assertEqual(repeated['mode'], 'verified-batch-reuse')
        self.assertEqual(verified['mode'], 'verify')
        for result in [repeated, verified]:
            self.assertEqual(result['adapterExecutions'], 0)
            self.assertEqual(result['writes'], 0)
        self.assertEqual(self.calls, [])
        self.assertEqual(snapshot(self.project), before)

    def test_verify_missing_output_and_conflicting_modes_have_no_writes(self):
        for options in [{'verify_only': True}, {'plan_only': True, 'verify_only': True},
                        {'plan_only': True, 'reuse_from': self.project / 'old'},
                        {'verify_only': True, 'reuse_from': self.project / 'old'}]:
            before = snapshot(self.project)
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.run_batch(**options)
            self.assertEqual(snapshot(self.project), before)

    def test_converter_failure_and_partial_results_block_only_declared_dependents(self):
        self.recipe['jobs'] = [self.job('failed'), self.job('needs-failed', ['failed']),
                               self.job('partial'), self.job('needs-partial', ['partial']), self.job('independent')]
        self.write_recipe()
        self.behaviors = {'failed': {'exit': 1}, 'partial': {'status': 'partial'}}
        result = self.run_batch()
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(self.calls, ['failed', 'partial', 'independent'])
        statuses = {row['id']: row['status'] for row in result['jobs']}
        self.assertEqual(statuses, {'failed': 'failed', 'needs-failed': 'blocked', 'partial': 'partial',
                                    'needs-partial': 'blocked', 'independent': 'converted'})
        self.assertEqual(result['jobs'][2]['unsupported'], ['one unresolved fixture field'])
        repeated = self.run_batch(verify_only=True)
        self.assertEqual(repeated['status'], 'failed')
        self.assertEqual(repeated['adapterExecutions'], 0)

    def test_partial_only_is_not_reported_as_complete(self):
        self.behaviors['first'] = {'status': 'partial'}
        result = self.run_batch()
        self.assertEqual(result['status'], 'partial')
        receipt = batch.load_json(self.output / 'batch.json')
        self.assertEqual(receipt['counts']['partialJobs'], 1)
        self.assertEqual(receipt['counts']['convertedJobs'], 0)

    def test_exit_status_and_collector_mismatch_or_invalid_products_fail_job(self):
        for identity, behavior in [('mismatch', {'exit': 2}), ('invalid', {'collect_error': True})]:
            with self.subTest(identity=identity):
                self.recipe['jobs'] = [self.job(identity)]
                self.behaviors[identity] = behavior
                self.write_recipe()
                result = self.run_batch(output=self.project / 'artifacts' / identity)
                self.assertEqual(result['status'], 'failed')
                self.assertEqual(result['jobs'][0]['status'], 'failed')
                self.assertEqual(result['jobs'][0]['coverage']['productIntegrity'], 'not-established')

    def test_output_tamper_is_fatal_and_never_silently_rebuilt(self):
        self.run_batch()
        self.calls.clear()
        (self.output / 'jobs/first/nested/data.bin').write_bytes(b'tampered')
        before = snapshot(self.project)
        with self.assertRaisesRegex(ValueError, 'hash/size differs'):
            self.run_batch()
        self.assertEqual(self.calls, [])
        self.assertEqual(snapshot(self.project), before)

    def test_receipt_count_tamper_is_rejected_by_completion_seal(self):
        self.run_batch()
        receipt = batch.load_json(self.output / 'batch.json')
        receipt['counts']['convertedJobs'] = 999
        self.write_json(self.output / 'batch.json', receipt)
        with self.assertRaises(ValueError):
            self.run_batch(verify_only=True)

    def test_source_recipe_and_component_pin_drift_reject_old_batch_without_writes(self):
        self.run_batch()
        self.calls.clear()
        original = self.child_recipe.read_bytes()
        self.child_recipe.write_bytes(original + b'\n')
        before = snapshot(self.project)
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.run_batch()
        self.assertEqual(snapshot(self.project), before)
        self.child_recipe.write_bytes(original)
        self.pin_version = 'two'
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.run_batch()
        self.pin_version = 'one'
        (self.source / 'source.bin').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'Source hash/size differs'):
            self.run_batch()
        self.assertEqual(self.calls, [])

    def test_source_mutation_during_execution_does_not_seal_success(self):
        self.on_execute = lambda identity: (self.source / 'source.bin').write_bytes(b'changed during conversion')
        with self.assertRaisesRegex(ValueError, 'Source hash/size differs|Source set changed'):
            self.run_batch()
        self.assertTrue((self.output / '.running.json').exists())
        self.assertFalse((self.output / 'batch.json').exists())
        with self.assertRaisesRegex(ValueError, 'active/interrupted'):
            batch.verify_batch(self.output)

    def test_recipe_mutation_during_execution_does_not_seal_success(self):
        self.on_execute = lambda identity: self.child_recipe.write_bytes(self.child_recipe.read_bytes() + b'\n')
        with self.assertRaises(ValueError):
            self.run_batch()
        self.assertTrue((self.output / '.running.json').exists())
        self.assertFalse((self.output / 'batch.json').exists())

    def test_implementation_pin_mutation_during_execution_does_not_seal_success(self):
        self.on_execute = lambda identity: setattr(self, 'pin_version', 'changed')
        with self.assertRaises(ValueError):
            self.run_batch()
        self.assertTrue((self.output / '.running.json').exists())
        self.assertFalse((self.output / 'batch.json').exists())

    def test_keyboard_interrupt_retains_non_reusable_lock_and_diagnostics(self):
        self.behaviors['first'] = {'interrupt': True}
        with self.assertRaises(KeyboardInterrupt):
            self.run_batch()
        self.assertTrue((self.output / '.running.json').is_file())
        self.assertFalse((self.output / 'batch.json').exists())
        before = snapshot(self.project)
        with self.assertRaisesRegex(ValueError, 'active/interrupted'):
            self.run_batch()
        self.assertEqual(snapshot(self.project), before)

    def test_subset_reuse_copies_verified_products_preserving_prior_hashes_and_mtimes(self):
        self.recipe['jobs'] = [self.job('first'), self.job('unused')]
        self.write_recipe()
        self.run_batch()
        prior_snapshot = snapshot(self.output)
        self.calls.clear()
        self.recipe['jobs'] = [self.job('first'), self.job('new')]
        self.write_recipe()
        new_output = self.project / 'artifacts/reused'
        result = self.run_batch(output=new_output, reuse_from=self.output)
        self.assertEqual(result['status'], 'converted')
        self.assertEqual(result['adapterExecutions'], 1)
        self.assertEqual(self.calls, ['new'])
        self.assertFalse((new_output / 'jobs/unused').exists())
        self.assertEqual((new_output / 'jobs/first/nested/data.bin').read_bytes(),
                         (self.output / 'jobs/first/nested/data.bin').read_bytes())
        self.assertEqual(snapshot(self.output), prior_snapshot)

    def test_reuse_refuses_corrupt_source_before_creating_target(self):
        self.run_batch()
        self.calls.clear()
        (self.output / 'jobs/first/fixture.json').write_bytes(b'corruption')
        target = self.project / 'artifacts/reuse-corrupt'
        before = snapshot(self.project)
        with self.assertRaisesRegex(ValueError, 'hash/size differs'):
            self.run_batch(output=target, reuse_from=self.output)
        self.assertFalse(target.exists())
        self.assertEqual(snapshot(self.project), before)
        self.assertEqual(self.calls, [])

    def test_reuse_cannot_overlap_source_or_use_nonfresh_target(self):
        self.run_batch()
        with self.assertRaisesRegex(ValueError, 'fresh'):
            self.run_batch(reuse_from=self.output)
        with self.assertRaisesRegex(ValueError, 'overlap'):
            self.run_batch(output=self.output / 'nested-result', reuse_from=self.output)

    def test_collector_cannot_publish_traversal_or_duplicate_case_products(self):
        for identity, products in [('traverse', ['../escape.bin']), ('duplicate', ['fixture.json', 'FIXTURE.json'])]:
            with self.subTest(identity=identity):
                original = batch.adapters.collect
                def invalid(job, output, source_lock, project_root=ROOT):
                    value = original(job, output, source_lock, project_root)
                    return {**value, 'products': products}
                with patch.object(batch.adapters, 'collect', invalid):
                    result = self.run_batch(output=self.project / 'artifacts' / identity)
                self.assertEqual(result['status'], 'failed')
                self.assertEqual(result['jobs'][0]['coverage']['productIntegrity'], 'not-established')


if __name__ == '__main__':
    unittest.main()
