import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.static_materials import (ELBERA_CROSS_CHECK_TOOL, LAYOUT_EVIDENCE_SOURCE, LAYOUT_REVIEWED_LICENSEES,
                                                REVIEWED_VERSION_EVIDENCE, REVIEWED_VERSIONS, STATIC_MATERIAL_CROSS_CHECKS_PATH,
                                                STATIC_MATERIAL_PACKAGE_VERSION, STATIC_MATERIAL_REAL_CLIENT_CASES_PATH,
                                                STATIC_MESH_CLASS_OBJECT,
                                                native_static_materials)
from native_assets_lib.static_material_cross_check import static_material_cross_check_row
from native_catalog.ue2 import Package
from data.pinned_elbera_module import ELBERA_ROOT
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, require_reference_client
from world.elbera_reader_cross_check import elbera_tool_record

CONVERSION_CLIENT_ROOT = Path('E:/Lineage2-client')
LAYOUT_REVIEWED_VERSIONS = frozenset((STATIC_MATERIAL_PACKAGE_VERSION, licensee) for licensee in LAYOUT_REVIEWED_LICENSEES)
CROSS_CHECK_ROWS = json.loads((ROOT / STATIC_MATERIAL_CROSS_CHECKS_PATH).read_bytes())['rows']
VERSION_CASES = json.loads((ROOT / STATIC_MATERIAL_REAL_CLIENT_CASES_PATH).read_bytes())['cases']


def reference_client_is_present():
    return CONVERSION_CLIENT_ROOT.is_dir() and REFERENCE_CLIENT_LOCK_PATH.is_file()


def cross_check_row_for(rows, version):
    matches = [row for row in rows if tuple(row['version']) == version]
    return matches[0] if len(matches) == 1 else None


def reviewed_version_evidence_problems(reviewed_versions, evidence_by_version, cross_check_rows, version_cases):
    problems = []
    case_versions = {(STATIC_MATERIAL_PACKAGE_VERSION, case['licenseeVersion']) for case in version_cases}
    for version in sorted(reviewed_versions):
        evidence = evidence_by_version.get(version)
        if evidence is None:
            problems.append(f'{version}: no evidence record')
            continue
        if evidence.get('layoutSource') != LAYOUT_EVIDENCE_SOURCE:
            problems.append(f'{version}: no layout source')
        if version not in case_versions:
            problems.append(f'{version}: no real-client case')
        if version in LAYOUT_REVIEWED_VERSIONS:
            continue
        cross_check = evidence.get('crossCheck')
        row = cross_check_row_for(cross_check_rows, version)
        if cross_check is None or row is None or row['equal'] is not True:
            problems.append(f'{version}: no equal cross-check row')
            continue
        result = cross_check['result']
        if (result['equal'] is not True or result['package'] != row['package'] or result['comparedExports'] != row['comparedExports']
                or result['referencesSha256'] != row['ourReferencesSha256'] or row['ourReferencesSha256'] != row['crossCheckReferencesSha256']):
            problems.append(f'{version}: evidence record differs from its cross-check row')
    return problems


class ReviewedVersionEvidenceTests(unittest.TestCase):
    def test_every_reviewed_version_has_an_evidence_record_and_cross_checked_ones_an_equal_row(self):
        self.assertEqual(set(REVIEWED_VERSION_EVIDENCE), set(REVIEWED_VERSIONS))
        self.assertEqual(reviewed_version_evidence_problems(REVIEWED_VERSIONS, REVIEWED_VERSION_EVIDENCE, CROSS_CHECK_ROWS, VERSION_CASES), [])

    def test_a_missing_record_a_missing_row_and_an_unequal_row_each_fail(self):
        cross_checked = sorted(REVIEWED_VERSIONS - LAYOUT_REVIEWED_VERSIONS)
        self.assertTrue(cross_checked)
        version = cross_checked[0]
        without_record = {key: value for key, value in REVIEWED_VERSION_EVIDENCE.items() if key != version}
        self.assertEqual(reviewed_version_evidence_problems(REVIEWED_VERSIONS, without_record, CROSS_CHECK_ROWS, VERSION_CASES),
                         [f'{version}: no evidence record'])
        without_row = [row for row in CROSS_CHECK_ROWS if tuple(row['version']) != version]
        self.assertEqual(reviewed_version_evidence_problems(REVIEWED_VERSIONS, REVIEWED_VERSION_EVIDENCE, without_row, VERSION_CASES),
                         [f'{version}: no equal cross-check row'])
        unequal_rows = [dict(row, equal=False) if tuple(row['version']) == version else row for row in CROSS_CHECK_ROWS]
        self.assertEqual(reviewed_version_evidence_problems(REVIEWED_VERSIONS, REVIEWED_VERSION_EVIDENCE, unequal_rows, VERSION_CASES),
                         [f'{version}: no equal cross-check row'])
        self.assertEqual(reviewed_version_evidence_problems(REVIEWED_VERSIONS | {(123, 13)}, REVIEWED_VERSION_EVIDENCE, CROSS_CHECK_ROWS,
                                                            VERSION_CASES),
                         ['(123, 13): no evidence record'])

    def test_a_reviewed_version_without_a_real_client_case_fails(self):
        for version in sorted(REVIEWED_VERSIONS):
            with self.subTest(version=version):
                cases_without_version = [case for case in VERSION_CASES
                                         if (STATIC_MATERIAL_PACKAGE_VERSION, case['licenseeVersion']) != version]
                self.assertEqual(reviewed_version_evidence_problems({version}, REVIEWED_VERSION_EVIDENCE, CROSS_CHECK_ROWS,
                                                                    cases_without_version),
                                 [f'{version}: no real-client case'])

    def test_cross_check_rows_name_the_pinned_elbera_tool_and_one_row_per_version(self):
        versions = [tuple(row['version']) for row in CROSS_CHECK_ROWS]
        self.assertEqual(len(versions), len(set(versions)))
        for row in CROSS_CHECK_ROWS:
            with self.subTest(version=row['version']):
                self.assertEqual(row['tool'], elbera_tool_record())
                self.assertEqual(sorted(row), ['comparedExports', 'crossCheckReferencesSha256', 'equal', 'firstDifferingExport',
                                               'lockSha256', 'ourReferencesSha256', 'package', 'tool', 'version'])
        for version in REVIEWED_VERSIONS - LAYOUT_REVIEWED_VERSIONS:
            cross_check = REVIEWED_VERSION_EVIDENCE[version]['crossCheck']
            self.assertEqual({'name': cross_check['tool'], 'commit': cross_check['commit'], 'pins': cross_check['pins']}, elbera_tool_record())
        self.assertEqual({'name': ELBERA_CROSS_CHECK_TOOL['tool'], 'commit': ELBERA_CROSS_CHECK_TOOL['commit'],
                          'pins': ELBERA_CROSS_CHECK_TOOL['pins']}, elbera_tool_record())


PACKAGES = {
    'field_deco_artifact_s.usx': '7d44217266e47b85efe2958587f925a084c93c5210c60981b8b2daae9cfe247d',
    'oren_tree_s.usx': '74072d7fce630aa045870be3ccd541bbe62ca34fc382987be6851037afd8dafb',
    'field_deco_S.usx': '205b3ec267f792944d500afeacdacf6e3a7465a529d1b348ca154851c18d0838',
}


def read_lock_equal_package_bytes(relative_path, expected_sha256):
    data = require_reference_client(CONVERSION_CLIENT_ROOT).require_equal_file(relative_path).read_bytes()
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        raise AssertionError('Native fixture differs from pinned source: ' + relative_path)
    return data


@unittest.skipUnless(reference_client_is_present(), 'needs --client E:/Lineage2-client and the committed reference client lock')
class RealSectionMaterialTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.packages = {name: Package(read_lock_equal_package_bytes('staticmeshes/' + name, expected), name)
                        for name, expected in PACKAGES.items()}

    def read(self, package_name, object_name):
        package = self.packages[package_name]
        item = next(x for x in package.exports if x['object'] == object_name)
        return package, native_static_materials(package, item)

    def test_world_obj14_retains_import_identity_despite_real_local_name_collision(self):
        package, result = self.read('field_deco_artifact_s.usx', 'field_deco_artifact_s.elf_ruin.world_obj14')
        matching = [x['object'] for x in package.imports + package.exports if x['object'].endswith('.sk_ruins.stone_033')]
        self.assertEqual(set(matching), {'Field_Deco_Artifact_T.sk_ruins.stone_033', 'field_deco_artifact_s.sk_ruins.stone_033'})
        self.assertEqual([x['nativeObjectIndex'] for x in result['slots']], [-14, -24])
        self.assertEqual([x['sourceReference'] for x in result['slots']],
                         ['Field_Deco_Artifact_T.sk_ruins.stone_033', 'Field_Deco_Artifact_T.sk_ruins.stone_07'])

    def test_all_six_section_meshes_have_exact_ordered_slots(self):
        cases = [
            ('field_deco_artifact_s.usx', 'field_deco_artifact_s.elf_ruin.elf_ruin02', [-37, -101, -265, -150, -144, -152, -146, -140, -37]),
            ('field_deco_artifact_s.usx', 'field_deco_artifact_s.elf_ruin.elf_ruin03', [-37, -141, -148, -101, -37, -37, -262, -144, -146, -147]),
            ('field_deco_artifact_s.usx', 'field_deco_artifact_s.elf_ruin.world_obj14', [-14, -24]),
            ('oren_tree_s.usx', 'oren_tree_s.Elf_Colors.Oren_elf_tree04', [-14, -15, -24]),
            ('field_deco_S.usx', 'field_deco_S.oren_stone.deco_oren_stone007', [-47, -53, -144]),
            ('field_deco_S.usx', 'field_deco_S.oren_stone.deco_oren_stone013', [-47]),
        ]
        for package_name, object_name, indices in cases:
            with self.subTest(mesh=object_name):
                package, result = self.read(package_name, object_name)
                self.assertEqual([x['slot'] for x in result['slots']], list(range(len(indices))))
                self.assertEqual([x['nativeObjectIndex'] for x in result['slots']], indices)
                self.assertEqual([x['sourceReference'] for x in result['slots']], [package.object_name(i) for i in indices])
                self.assertTrue(all(x['referenceStatus'] == 'exact-native-object-index' for x in result['slots']))
                classes = ['Texture', 'Texture', 'Shader'] if package_name == 'oren_tree_s.usx' else ['Texture'] * len(indices)
                self.assertEqual([x['sourceClass'] for x in result['slots']], classes)

    def test_tree_collision_and_shadow_flags_remain_per_slot(self):
        _, result = self.read('oren_tree_s.usx', 'oren_tree_s.Elf_Colors.Oren_elf_tree04')
        self.assertEqual([x['properties']['EnableCollision'] for x in result['slots']], [True, True, False])
        self.assertEqual([x['properties']['EnableCollisionforShadow'] for x in result['slots']], [True, True, True])
        self.assertEqual([x['properties']['bNoDynamicShadowCast'] for x in result['slots']], [False, False, True])
        self.assertIn('bSwayObject', [x['name'] for x in result['meshPropertyTags']])


class RealClientCaseFixtureTests(unittest.TestCase):
    def test_the_twenty_layout_reviewed_objects_keep_their_280_slots_and_every_cross_checked_package_has_cases(self):
        layout_reviewed_cases = [row for row in VERSION_CASES if (123, row['licenseeVersion']) in LAYOUT_REVIEWED_VERSIONS]
        self.assertEqual(len(layout_reviewed_cases), 20)
        self.assertEqual(sum(len(row['materialIndices']) for row in layout_reviewed_cases), 280)
        case_packages = {row['package'] for row in VERSION_CASES}
        for row in CROSS_CHECK_ROWS:
            if row['equal']:
                self.assertIn(row['package'], case_packages)
                self.assertEqual({case['packageSha256'] for case in VERSION_CASES if case['package'] == row['package']}, {row['lockSha256']})
                self.assertEqual(sum(1 for case in VERSION_CASES if case['package'] == row['package']), row['comparedExports'])
        for row in VERSION_CASES:
            self.assertEqual(len(row['materialIndices']), len(row['slotByteSha256s']))
            if row['materialsPayloadSha256'] is None:
                self.assertEqual(row['materialIndices'], [])


@unittest.skipUnless(reference_client_is_present(), 'needs --client E:/Lineage2-client and the committed reference client lock')
class ExpandedSectionMaterialTests(unittest.TestCase):
    def test_every_real_client_case_consumes_its_original_ordered_slots_without_source_mutation(self):
        packages = {}
        total = 0
        for row in VERSION_CASES:
            with self.subTest(object=row['object'], version=row['licenseeVersion']):
                if row['package'] not in packages:
                    packages[row['package']] = Package(read_lock_equal_package_bytes(row['package'], row['packageSha256']),
                                                       Path(row['package']).name)
                package = packages[row['package']]
                original_hash = hashlib.sha256(package.data).hexdigest()
                matches = [item for item in package.exports
                           if item['object'] == row['object'] and item['classObject'] == STATIC_MESH_CLASS_OBJECT]
                self.assertEqual(len(matches), 1)
                item = matches[0]
                result = native_static_materials(package, item)
                self.assertEqual(result['layout']['licenseeVersion'], row['licenseeVersion'])
                slots = result['slots']
                self.assertEqual([slot['nativeObjectIndex'] for slot in slots], row['materialIndices'])
                self.assertEqual([slot['sourceReference'] for slot in slots], [package.object_name(index) for index in row['materialIndices']])
                self.assertEqual([slot['raw']['sha256'] for slot in slots], row['slotByteSha256s'])
                self.assertEqual([slot['slot'] for slot in slots], list(range(len(slots))))
                if row['materialsPayloadSha256'] is None:
                    self.assertEqual(result['materialsStatus'], 'omitted')
                else:
                    self.assertEqual(result['materialsPayload']['sha256'], row['materialsPayloadSha256'])
                    for first, second in zip(slots, slots[1:]):
                        self.assertEqual(first['raw']['offset'] + first['raw']['bytes'], second['raw']['offset'])
                    if slots:
                        self.assertEqual(slots[-1]['raw']['offset'] + slots[-1]['raw']['bytes'],
                                         result['materialsPayload']['offset'] + result['materialsPayload']['bytes'])
                self.assertEqual(hashlib.sha256(package.data).hexdigest(), original_hash)
                total += len(slots)
        self.assertEqual(total, sum(len(row['materialIndices']) for row in VERSION_CASES))


@unittest.skipUnless(reference_client_is_present() and ELBERA_ROOT.is_dir(),
                     'needs --client E:/Lineage2-client, the committed reference client lock and the pinned Elbera checkout')
class ElberaStaticMaterialCrossCheckTests(unittest.TestCase):
    def test_every_recorded_cross_check_reproduces_against_the_reference_client(self):
        reference_access = require_reference_client(CONVERSION_CLIENT_ROOT)
        for row in CROSS_CHECK_ROWS:
            with self.subTest(version=row['version'], package=row['package']):
                self.assertEqual(static_material_cross_check_row(reference_access, row['package']), row)


if __name__ == '__main__':
    unittest.main()
