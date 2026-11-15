from __future__ import annotations

from collections import Counter
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from material_graph_fixture import compact
from native_catalog.ue2 import Package
from reference_client_guard import (ENGINE_LIBRARY_RELATIVE_PATH, REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock,
                                    require_reference_client)
from reference_client_lock_fixture import equal_lock_record, use_synthetic_reference_client_lock, write_synthetic_engine_library
from native_assets_lib.asset_manifest import reference_client_build

CENSUS_SCRIPT_PATH = ROOT / 'scripts' / 'audit-material-census.py'
CONVERSION_CLIENT_ROOT = Path('E:/Lineage2-client')
PACKAGE_SIGNATURE = 0x9e2a83c1
PACKAGE_SUMMARY_FORMAT = '<IHHIIIIIII'


def load_census_module():
    specification = importlib.util.spec_from_file_location('audit_material_census', CENSUS_SCRIPT_PATH)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


material_census = load_census_module()


class SyntheticPackageTableWriter:
    def __init__(self, package_name, version=123, licensee=0):
        self.package_name, self.version, self.licensee = package_name, version, licensee
        self.names, self.imports, self.exports = ['None'], [], []

    def name_index(self, text):
        if text not in self.names:
            self.names.append(text)
        return self.names.index(text)

    def import_index(self, class_package, class_name, outer_index, name):
        record = (class_package, class_name, outer_index, name)
        if record not in self.imports:
            self.imports.append(record)
        return -(self.imports.index(record) + 1)

    def imported_object(self, object_name, class_object):
        package_name, leaf_name = object_name.split('.')
        class_package, class_name = class_object.split('.')
        return self.import_index(class_package, class_name, self.import_index('Core', 'Package', 0, package_name), leaf_name)

    def object_index(self, object_name, class_object):
        package_name, leaf_name = object_name.split('.')
        if package_name == self.package_name:
            return next(index for index, (_, _, name) in enumerate(self.exports, 1) if name == leaf_name)
        return self.imported_object(object_name, class_object)

    def export_class(self, class_name, super_class=None):
        super_index = 0 if super_class is None else self.object_index(super_class, 'Core.Class')
        self.exports.append((0, super_index, class_name))
        return self

    def export_object(self, name, class_object):
        self.exports.append((self.imported_object(class_object, 'Core.Class'), 0, name))
        return self

    def package_bytes(self):
        for class_package, class_name, _, name in self.imports:
            for text in (class_package, class_name, name):
                self.name_index(text)
        for _, _, name in self.exports:
            self.name_index(name)
        names = b''.join(compact(len(name) + 1) + name.encode('cp1252') + b'\0' + struct.pack('<I', 0) for name in self.names)
        imports = b''.join(compact(self.name_index(class_package)) + compact(self.name_index(class_name)) + struct.pack('<i', outer_index)
                           + compact(self.name_index(name)) for class_package, class_name, outer_index, name in self.imports)
        exports = b''.join(compact(class_index) + compact(super_index) + struct.pack('<i', 0) + compact(self.name_index(name))
                           + struct.pack('<I', 0) + compact(0) for class_index, super_index, name in self.exports)
        summary_size = struct.calcsize(PACKAGE_SUMMARY_FORMAT)
        name_offset, import_offset = summary_size, summary_size + len(names)
        export_offset = import_offset + len(imports)
        header = struct.pack(PACKAGE_SUMMARY_FORMAT, PACKAGE_SIGNATURE, self.version, self.licensee, 0, len(self.names), name_offset,
                             len(self.exports), export_offset, len(self.imports), import_offset)
        return header + names + imports + exports


def synthetic_client_packages():
    core = SyntheticPackageTableWriter('Core').export_class('Object')
    engine = (SyntheticPackageTableWriter('Engine').export_class('Material', 'Core.Object').export_class('Texture', 'Engine.Material')
              .export_class('Shader', 'Engine.Material').export_class('Cubemap', 'Engine.Texture')
              .export_class('MaterialSequence', 'Engine.Material').export_class('Palette', 'Core.Object'))
    effects = (SyntheticPackageTableWriter('Effects').export_object('Glow', 'Engine.Texture').export_object('Spark', 'Engine.Texture')
               .export_object('GlowShader', 'Engine.Shader').export_object('GlowPalette', 'Engine.Palette')
               .export_object('Sky', 'Engine.Cubemap'))
    old_skies = SyntheticPackageTableWriter('OldSkies', version=118).export_object('Night', 'Engine.Texture').export_object(
        'NightSequence', 'Engine.MaterialSequence')
    meshes = SyntheticPackageTableWriter('Meshes', licensee=28).export_object('RockShader', 'Engine.Shader')
    tile = SyntheticPackageTableWriter('20_20').export_object('Ground', 'Engine.Texture').export_object('Model0', 'Engine.Model')
    tile.export_object('Thing', 'Mystery.Thing')
    unsupported = SyntheticPackageTableWriter('Unsupported', version=100).export_object('Lost', 'Engine.Texture')
    return {'system/Core.u': core, 'system/Engine.u': engine, 'textures/Effects.utx': effects, 'textures/OldSkies.utx': old_skies,
            'staticmeshes/Meshes.usx': meshes, 'maps/20_20.unr': tile, 'textures/Unsupported.utx': unsupported}


class SyntheticMaterialCensusTests(unittest.TestCase):
    def setUp(self):
        client_directory = tempfile.TemporaryDirectory()
        self.addCleanup(client_directory.cleanup)
        self.client_root = Path(client_directory.name)
        write_synthetic_engine_library(self.client_root)
        files = {ENGINE_LIBRARY_RELATIVE_PATH: equal_lock_record(self.client_root / ENGINE_LIBRARY_RELATIVE_PATH)}
        for relative_path, writer in synthetic_client_packages().items():
            package_path = self.client_root / relative_path
            package_path.parent.mkdir(parents=True, exist_ok=True)
            package_path.write_bytes(writer.package_bytes())
            files[relative_path] = equal_lock_record(package_path)
        use_synthetic_reference_client_lock(self, self.client_root, files)

    def test_material_classes_are_counted_from_export_tables_and_marked_reviewed_or_unported(self):
        census = material_census.build_material_class_census(require_reference_client(self.client_root))
        self.assertEqual(census['classes'], [
            {'class': 'Engine.Cubemap', 'exportCount': 1, 'packageCount': 1, 'status': 'material-class-unported'},
            {'class': 'Engine.MaterialSequence', 'exportCount': 1, 'packageCount': 1, 'status': 'reviewed'},
            {'class': 'Engine.Shader', 'exportCount': 2, 'packageCount': 2, 'status': 'reviewed'},
            {'class': 'Engine.Texture', 'exportCount': 4, 'packageCount': 3, 'status': 'reviewed'}])
        self.assertEqual(census['unresolvedClasses'], [
            {'class': 'Engine.Model', 'exportCount': 1, 'packageCount': 1, 'reason': 'no-script-class-export'},
            {'class': 'Mystery.Thing', 'exportCount': 1, 'packageCount': 1, 'reason': 'script-package-not-lock-equal'}])
        self.assertEqual(census['unreadablePackages'], [{'path': 'textures/Unsupported.utx', 'reason': 'decode-failed:MaterialCensusError'}])
        self.assertEqual(census['packageCount'], 4)
        self.assertEqual(census['referenceTreeLockSha256'],
                         reference_client_build(require_reference_client(self.client_root).lock)['referenceTreeLockSha256'])
        self.assertEqual(material_census.material_class_gap_reasons(census), ['material-class-unported:Engine.Cubemap'])

    def test_the_writer_puts_the_census_where_the_output_option_points(self):
        output_path = self.client_root.parent / (self.client_root.name + '-census') / 'material-class-census.json'
        self.addCleanup(lambda: output_path.unlink(missing_ok=True) or output_path.parent.rmdir())
        census = material_census.build_material_class_census(require_reference_client(self.client_root))
        material_census.write_material_class_census(census, output_path)
        self.assertEqual(json.loads(output_path.read_bytes()), census)

    def test_a_census_with_a_wrong_status_or_unsorted_rows_is_refused(self):
        census = material_census.build_material_class_census(require_reference_client(self.client_root))
        wrong_status = json.loads(json.dumps(census))
        wrong_status['classes'][0]['status'] = 'reviewed'
        unsorted_rows = json.loads(json.dumps(census))
        unsorted_rows['classes'].reverse()
        for case, document in {'wrong status': wrong_status, 'unsorted rows': unsorted_rows}.items():
            with self.subTest(case=case), self.assertRaises(material_census.MaterialCensusError):
                material_census.validate_material_class_census(document)


class CommittedMaterialCensusTests(unittest.TestCase):
    def test_the_committed_census_is_valid_and_pinned_to_the_reference_client_lock(self):
        census = json.loads((ROOT / material_census.MATERIAL_CLASS_CENSUS_RELATIVE_PATH).read_bytes())
        material_census.validate_material_class_census(census)
        self.assertEqual(census['referenceTreeLockSha256'],
                         reference_client_build(read_reference_client_lock(REFERENCE_CLIENT_LOCK_PATH))['referenceTreeLockSha256'])
        self.assertTrue({row['status'] for row in census['classes']} <= {'reviewed', 'material-class-unported'})


@unittest.skipUnless(CONVERSION_CLIENT_ROOT.is_dir() and REFERENCE_CLIENT_LOCK_PATH.is_file(),
                     'needs --client E:/Lineage2-client and the committed reference client lock')
class ReferenceClientMaterialCensusTests(unittest.TestCase):
    def test_the_table_reader_agrees_with_the_package_reader_and_resolves_effect_classes(self):
        client_access = require_reference_client(CONVERSION_CLIENT_ROOT)
        tables = material_census.read_lock_equal_tables(client_access, 'textures/FX_E_T.utx')
        package_path = client_access.require_equal_file('textures/FX_E_T.utx')
        package = Package(package_path.read_bytes(), package_path.name)
        self.assertEqual([tables.object_name(export['classIndex']) or 'Core.Class' for export in tables.exports],
                         [export['classObject'] for export in package.exports])
        resolver = material_census.MaterialClassResolver(client_access)
        material_counts = Counter(package_export['classObject'] for package_export in package.exports
                                  if package_export['classObject'] not in ('Core.Class', 'Core.Package')
                                  and resolver.is_material_class(package_export['classObject']))
        committed = json.loads((ROOT / material_census.MATERIAL_CLASS_CENSUS_RELATIVE_PATH).read_bytes())
        committed_classes = {row['class'] for row in committed['classes']}
        self.assertTrue(set(material_counts) <= committed_classes)
        self.assertEqual((material_counts['Engine.Texture'], material_counts['Engine.Shader'], material_counts['Engine.Cubemap']), (277, 36, 3))
        self.assertFalse(resolver.is_material_class('Engine.Palette'))
        self.assertTrue(resolver.is_material_class('Engine.TexOscillatorTriggered'))


if __name__ == '__main__':
    unittest.main()
