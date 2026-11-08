import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_store.store_paths import (ConverterOutputRefusedError, StorePathError, confined_child_path,
                                      lane_gap_rows_path, lane_load_check_path, lane_store_root, lane_work_root,
                                      read_lane_parts_by_name, refuse_reparse_points, require_converter_output,
                                      require_portable_relative_path)

REPARSE_REFUSAL_PREFIX = 'Symlink/junction/reparse boundary refused: '
CATALOG_SHA256 = 'a' * 64

try:
    import _winapi
    JUNCTION_FACTORY = _winapi.CreateJunction
except (ImportError, AttributeError) as error:
    JUNCTION_FACTORY = None
    JUNCTION_UNAVAILABLE_REASON = f'NTFS junctions unavailable: {error}'


def snapshot_tree(root):
    return sorted((path.relative_to(root).as_posix(), path.read_bytes()) for path in root.rglob('*') if path.is_file())


class StorePathTestCase(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.temporary_root = Path(temporary_directory.name).resolve()
        self.project = self.temporary_root / 'project'
        (self.project / 'artifacts').mkdir(parents=True)
        self.junction_unavailable_reason = self.probe_junctions()

    def probe_junctions(self):
        if JUNCTION_FACTORY is None:
            return JUNCTION_UNAVAILABLE_REASON
        probe_target = self.temporary_root / 'probe-target'
        probe_target.mkdir()
        try:
            self.make_junction(self.temporary_root / 'probe-link', probe_target)
        except OSError as error:
            return f'NTFS junctions unavailable: {error}'
        return None

    def make_junction(self, link, target):
        JUNCTION_FACTORY(str(target), str(link))
        self.addCleanup(os.rmdir, link)
        return link

    def require_junctions(self):
        if self.junction_unavailable_reason is not None:
            self.skipTest(self.junction_unavailable_reason)

    def make_target_folder(self, name):
        target = self.temporary_root / name
        target.mkdir()
        (target / 'store-file.bin').write_bytes(b'shared store bytes')
        return target


class ReparsePointRefusalTests(StorePathTestCase):
    def test_plain_folder_returns_its_resolved_path(self):
        folder = self.temporary_root / 'plain'
        folder.mkdir()
        self.assertEqual(refuse_reparse_points(folder), folder.resolve())

    def test_path_below_a_junction_names_the_junction(self):
        self.require_junctions()
        junction = self.make_junction(self.temporary_root / 'link', self.make_target_folder('target'))
        with self.assertRaises(StorePathError) as refusal:
            refuse_reparse_points(junction / 'below' / 'file.json')
        self.assertTrue(str(refusal.exception).startswith(REPARSE_REFUSAL_PREFIX))
        self.assertEqual(str(refusal.exception), REPARSE_REFUSAL_PREFIX + str(junction))

    def test_nested_junctions_name_the_one_nearest_to_the_path(self):
        self.require_junctions()
        outer_target = self.make_target_folder('outer-target')
        outer = self.make_junction(self.temporary_root / 'outer', outer_target)
        self.make_junction(outer_target / 'inner', self.make_target_folder('inner-target'))
        refusals = []
        for _ in range(2):
            with self.assertRaises(StorePathError) as refusal:
                refuse_reparse_points(outer / 'inner' / 'x')
            refusals.append(str(refusal.exception))
        self.assertEqual(refusals, [REPARSE_REFUSAL_PREFIX + str(outer / 'inner')] * 2)


class ConfinedChildPathTests(StorePathTestCase):
    def test_child_inside_the_root_is_returned(self):
        root = self.temporary_root / 'root'
        root.mkdir()
        self.assertEqual(confined_child_path(root, 'a/b.json'), root.resolve() / 'a' / 'b.json')

    def test_parent_steps_are_refused_as_unsafe_names(self):
        root = self.temporary_root / 'root'
        root.mkdir()
        for relative in ('../x', 'a/../../x'):
            with self.subTest(relative=relative), self.assertRaisesRegex(StorePathError, '^Unsafe relative path: '):
                confined_child_path(root, relative)

    def test_child_reached_through_a_junction_inside_the_root_is_refused(self):
        self.require_junctions()
        root = self.temporary_root / 'root'
        root.mkdir()
        self.make_junction(root / 'link', self.make_target_folder('target'))
        with self.assertRaisesRegex(StorePathError, '^Symlink/junction/reparse boundary refused: '):
            confined_child_path(root, 'link/file.json')


class PortableRelativePathTests(unittest.TestCase):
    def test_unportable_names_are_refused(self):
        for value in ('', None, 'a\\b', 'a:b', 'a/./b', 'a//b', 'CON', 'nul.txt', 'COM1', 'a/b ', 'a/b.',
                      'a*b', 'a?b', 'a<b', 'a>b', 'a"b', 'a|b', 'a\x01b'):
            with self.subTest(value=value), self.assertRaisesRegex(StorePathError, '^Unsafe relative path: '):
                require_portable_relative_path(value)

    def test_portable_name_is_returned_unchanged(self):
        self.assertEqual(require_portable_relative_path('tiles/abc/tile.json'), 'tiles/abc/tile.json')


class LanePathTests(StorePathTestCase):
    def test_lane_parts_come_from_the_repository_lane_ownership(self):
        ownership = json.loads((ROOT / '.planning' / 'lanes.json').read_text(encoding='utf-8'))
        parts_by_lane_name = read_lane_parts_by_name()
        self.assertEqual(sorted(parts_by_lane_name), ['actors', 'data-ui', 'integration', 'world'])
        self.assertEqual(parts_by_lane_name, {name: tuple(lane['parts']) for name, lane in ownership['lanes'].items()})

    def test_lane_locations_are_built_under_the_project_artifacts(self):
        lane_store = self.project / 'artifacts' / 'lane-store'
        self.assertEqual(lane_store_root(self.project, 'world'), lane_store / 'world' / 'l2')
        self.assertEqual(lane_work_root(self.project, 'actors'), lane_store / 'actors' / 'work')
        self.assertEqual(lane_gap_rows_path(self.project, 'data-ui', 'raw'), lane_store / 'data-ui' / 'gap-rows' / 'raw.json')
        self.assertEqual(lane_load_check_path(self.project, 'world', CATALOG_SHA256),
                         lane_store / 'world' / 'load-checks' / f'{CATALOG_SHA256}.json')
        self.assertFalse(lane_store.exists())

    def test_unknown_lane_lists_the_known_lanes(self):
        with self.assertRaisesRegex(StorePathError, '^unknown lane plan; lanes: actors, data-ui, integration, world$'):
            lane_store_root(self.project, 'plan')

    def test_invalid_step_and_catalog_hash_are_refused(self):
        for step in ('', 'Raw', '1raw', 'raw/x', 'r' * 65, None):
            with self.subTest(step=step), self.assertRaisesRegex(StorePathError, '^step name must match'):
                lane_gap_rows_path(self.project, 'world', step)
        for catalog_sha256 in ('', 'A' * 64, 'a' * 63, 'g' * 64, None):
            with self.subTest(catalog_sha256=catalog_sha256), self.assertRaisesRegex(StorePathError, '^catalog SHA-256 must be'):
                lane_load_check_path(self.project, 'world', catalog_sha256)


class ConverterOutputGuardTests(StorePathTestCase):
    def assert_refused(self, output, message_pattern):
        with self.assertRaisesRegex(ConverterOutputRefusedError, message_pattern):
            require_converter_output(self.project, output)

    def test_dedicated_artifacts_folders_are_accepted_without_creating_them(self):
        lane_store = self.project / 'artifacts' / 'lane-store' / 'world' / 'l2'
        self.assertEqual(require_converter_output(self.project, lane_store), lane_store)
        self.assertEqual(require_converter_output(self.project, self.project / 'ARTIFACTS' / 'x'), self.project / 'artifacts' / 'x')
        self.assertEqual(require_converter_output(self.project, str(lane_store)), lane_store)
        self.assertFalse((self.project / 'artifacts' / 'lane-store').exists())
        self.assertFalse((self.project / 'artifacts' / 'x').exists())

    def test_empty_outputs_are_refused_by_name(self):
        self.assert_refused('', "^converter output is empty: ''$")
        self.assert_refused(None, '^converter output is empty: None$')

    def test_outputs_outside_a_dedicated_artifacts_folder_are_refused(self):
        (self.project / 'artifacts-extra').mkdir()
        (self.project / 'public' / 'l2x').mkdir(parents=True)
        for output in (self.project / 'artifacts', self.project, self.temporary_root / 'elsewhere',
                       self.project / 'artifacts-extra' / 'x', self.project / 'public' / 'l2',
                       self.project / 'PUBLIC' / 'L2' / 'x', self.project / 'public' / 'l2x' / 'x',
                       self.project / 'artifacts' / '..' / 'public' / 'x'):
            with self.subTest(output=output):
                self.assert_refused(output, '^converter output must be a dedicated folder under ')

    def test_output_through_a_junction_inside_artifacts_is_refused(self):
        self.require_junctions()
        target = self.make_target_folder('target')
        before = snapshot_tree(target)
        self.make_junction(self.project / 'artifacts' / 'link', target)
        self.assert_refused(self.project / 'artifacts' / 'link' / 'x', '^Symlink/junction/reparse boundary refused: ')
        self.assertEqual(snapshot_tree(target), before)

    def test_output_under_the_public_store_junction_is_refused(self):
        self.require_junctions()
        target = self.make_target_folder('shared-store')
        before = snapshot_tree(target)
        (self.project / 'public').mkdir()
        self.make_junction(self.project / 'public' / 'l2', target)
        for output in (self.project / 'public' / 'l2', self.project / 'public' / 'l2' / 'out'):
            with self.subTest(output=output):
                self.assert_refused(output, '^Symlink/junction/reparse boundary refused: ')
        self.assertEqual(snapshot_tree(target), before)

    def test_output_inside_the_realpath_of_the_public_store_is_refused(self):
        self.require_junctions()
        store_target = self.project / 'artifacts' / 'store'
        store_target.mkdir()
        (self.project / 'public').mkdir()
        self.make_junction(self.project / 'public' / 'l2', store_target)
        for output in (store_target, store_target / 'out'):
            with self.subTest(output=output):
                self.assert_refused(output, '^converter output resolves into the shared native store ')


class ConverterBindingTests(StorePathTestCase):
    def test_converter_refuses_the_public_store_junction_before_reading_the_client(self):
        self.require_junctions()
        import native_assets
        target = self.make_target_folder('shared-store')
        before = snapshot_tree(target)
        (self.project / 'public').mkdir()
        self.make_junction(self.project / 'public' / 'l2', target)
        client = self.temporary_root / 'client'
        client.mkdir()
        umodel = self.temporary_root / 'umodel.exe'
        umodel.write_bytes(b'u')
        with patch('native_assets.UMODEL_SHA256', hashlib.sha256(umodel.read_bytes()).hexdigest()), \
                patch('pathlib.Path.rglob') as package_index, \
                patch('native_assets.require_reference_client') as reference_client_guard, \
                self.assertRaisesRegex(ConverterOutputRefusedError, '^Symlink/junction/reparse boundary refused: '):
            native_assets.Converter(client, self.project / 'public' / 'l2' / 'out', umodel, project_root=self.project)
        package_index.assert_not_called()
        reference_client_guard.assert_not_called()
        self.assertEqual(snapshot_tree(target), before)
        self.assertFalse((target / 'out').exists())


if __name__ == '__main__':
    unittest.main()
