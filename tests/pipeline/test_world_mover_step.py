import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_catalog.ue2 import FormatError
from native_assets_lib.static_materials import REVIEWED_VERSIONS
from native_store.gap_rows import load_gap_reason_patterns, validate_gap_row
from native_store.tile_manifest_validation import TileManifestError, load_tile_manifest_vocabulary, validate_tile_manifest
from support.converted_model_fixture import converted_model_glb
from world.collision_payload_groups import movr_arrays
from world.collision_step import mover_slot_records
from world.mover_class_defaults import MoverDefaults, qualified_classes
from world.mover_records import (MOVER_UNSUPPORTED_TOKENS, MoverUnsupportedError, endpoint_matrix, endpoint_source_rows, indexed_properties,
                                 is_rigid_rows, mover_mesh, non_rigid_key_token, qualified_motion, resolved_field)
from world.mover_step import (MOVER_STEP_NAME, MoverConversion, MoverStepError, ReadMover, converted_movers, mover_models, read_tile_movers,
                              require_every_mover_classified, run_mover_step)
from world.static_mesh_step import ConvertedStaticMesh, package_gate_reason
from world.static_placement_plan import ChunkRectangle
from world.tile_manifest_step import PENDING_TILE_STEPS, pending_steps_after_sealed, tile_resources

TILE_ID = '00_00'
LANE_FOLDER = ROOT / 'artifacts' / 'lane-store' / 'world'
ORACLE_PATH = ROOT / 'recipes' / 'world' / 'oracle' / '20_20' / 'expected.json'
SERVED_STORE = ROOT / 'public' / 'l2'
REFERENCE_CLIENT = Path('E:/Lineage2-client')
MOVER_CLASS_EVIDENCE = LANE_FOLDER / 'work' / 'class__Engine.Mover' / 'class-defaults' / 'products'
SLOT_ROWS = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [10.0, 20.0, 30.0, 1.0]]
OPEN_ROWS = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [10.0, 20.0, 166.0, 1.0]]


def product_mover(index, decision, slots, origin=(100.0, 100.0, 0.0), model_file='models/fixture/model.glb'):
    return {'id': f'interlude:{TILE_ID}.Mover{index}', 'object': f'{TILE_ID}.Mover{index}', 'exportIndex': index,
            'modelId': 'interlude:fixture_s.Door', 'model': {'file': model_file}, 'origin': list(origin),
            'closedSourceRows': SLOT_ROWS, 'openSourceRows': OPEN_ROWS,
            'collision': {'decision': decision, 'slots': list(slots), 'evidence': [] if decision == 'slots' else ['rule-disagreement:bStatic']}}


class MoverCollisionGroupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.store_root = Path(self.temporary.name)
        (self.store_root / 'models' / 'fixture').mkdir(parents=True)
        (self.store_root / 'models' / 'fixture' / 'model.glb').write_bytes(converted_model_glb([True, False, True]))
        self.rectangles = [ChunkRectangle('chunk-0-0', (0.0, 0.0), (1000.0, 1000.0))]

    def tearDown(self):
        self.temporary.cleanup()

    def test_a_slots_decision_adds_one_movr_record_per_listed_slot_with_both_matrices_in_source_units(self):
        movers = {'movers': [product_mover(5, 'slots', [0, 2]), product_mover(9, 'gap', [])]}
        movers_by_chunk, decisions = mover_slot_records({'storeRoot': self.store_root}, movers, self.rectangles, {})
        records = movers_by_chunk['chunk-0-0']
        self.assertEqual([(record['moverId'], record['slot'], record['collisionSource']) for record in records],
                         [(f'interlude:{TILE_ID}.Mover5', 0, 'static-slot-enable-collision'), (f'interlude:{TILE_ID}.Mover5', 2, 'static-slot-enable-collision')])
        self.assertEqual([record['closedMatrix'] for record in records], [SLOT_ROWS, SLOT_ROWS])
        self.assertEqual([record['openMatrix'] for record in records], [OPEN_ROWS, OPEN_ROWS])
        self.assertEqual([decision['decision'] for decision in decisions], ['slots', 'gap'])
        arrays = {array.name: array.values for array in movr_arrays(records)}
        self.assertEqual((arrays['MOVR.exportIndex'], arrays['MOVR.slot'], arrays['MOVR.collisionSource']), ((5, 5), (0, 2), (0, 0)))
        self.assertEqual(len(arrays['MOVR.closedMatrix']), 32)
        self.assertEqual(arrays['MOVR.openMatrix'][14], 166.0)

    def test_a_gap_decision_adds_no_movr_record_and_keeps_the_gap_for_one_collision_unreadable_row(self):
        movers_by_chunk, decisions = mover_slot_records({'storeRoot': self.store_root}, {'movers': [product_mover(9, 'gap', [])]}, self.rectangles, {})
        self.assertEqual(movers_by_chunk, {})
        self.assertEqual([(decision['decision'], decision['object']) for decision in decisions], [('gap', f'{TILE_ID}.Mover9')])

    def test_a_slots_mover_outside_the_chunk_grid_becomes_a_gap(self):
        movers_by_chunk, decisions = mover_slot_records({'storeRoot': self.store_root},
                                                        {'movers': [product_mover(5, 'slots', [0], origin=(5000.0, 5000.0, 0.0))]}, self.rectangles, {})
        self.assertEqual(movers_by_chunk, {})
        self.assertEqual((decisions[0]['decision'], decisions[0]['evidence']), ('gap', ['chunk:outside-grid']))

    def test_mover_meshes_are_never_merged_with_a_static_placement_of_the_same_model(self):
        meshes_by_chunk = {'chunk-0-0': {('interlude:fixture_s.Door', (0,)): {'index': 0}}}
        movers_by_chunk, _ = mover_slot_records({'storeRoot': self.store_root}, {'movers': [product_mover(5, 'slots', [0])]}, self.rectangles,
                                                meshes_by_chunk)
        self.assertEqual(movers_by_chunk['chunk-0-0'][0]['mesh'], 1)
        self.assertEqual(len(meshes_by_chunk['chunk-0-0']), 2)


def converted(model_id, source_object):
    return ConvertedStaticMesh({'id': model_id, 'sourceObject': source_object, 'model': {'file': 'x/model.glb'}}, {})


class FakeMapPackage:
    def __init__(self, exports):
        self.exports = exports


class MoverReadingTests(unittest.TestCase):
    def test_movers_are_read_in_export_order_and_every_unqualified_mover_is_a_named_gap(self):
        exports = [{'classObject': 'Engine.Mover', 'exportIndex': index, 'object': f'{TILE_ID}.Mover{index}', 'name': f'Mover{index}'} for index in (30, 4, 12)]
        exports.append({'classObject': 'Engine.StaticMeshActor', 'exportIndex': 2, 'object': f'{TILE_ID}.StaticMeshActor2', 'name': 'StaticMeshActor2'})

        def read(package, item, *_):
            if item['exportIndex'] == 12:
                raise MoverUnsupportedError('key-count:3')
            return {'id': 'interlude:' + item['object']}, {'object': 'fixture_s.Door', 'package': 'staticmeshes/fixture_s.usx'}, {}

        gaps = []
        with mock.patch('world.mover_step.read_mover_actor', side_effect=read):
            items, read_movers = read_tile_movers(FakeMapPackage(exports), None, None, TILE_ID, lambda item, status, reason: gaps.append((item['exportIndex'], reason)))
        self.assertEqual([item['exportIndex'] for item in items], [4, 12, 30])
        self.assertEqual([mover.item['exportIndex'] for mover in read_movers], [4, 30])
        self.assertEqual(gaps, [(12, 'mover-unsupported:key-count:3')])

    def test_two_movers_sharing_one_mesh_share_one_model_record_and_models_sort_by_source_object(self):
        door, gate = converted('interlude:fixture_s.Door', 'fixture_s.Door'), converted('interlude:fixture_s.Gate', 'fixture_s.Gate')
        models = mover_models([(None, gate), (None, door), (None, door)])
        self.assertEqual([model['id'] for model in models], ['interlude:fixture_s.Door', 'interlude:fixture_s.Gate'])


def tile_manifest_with(resources):
    chunk_sha256 = '1' * 64
    return {'kind': 'native-tile-runtime', 'schemaVersion': 1, 'tileId': TILE_ID, 'sourceMap': f'maps/{TILE_ID}.unr', 'sourceSha256': 'c' * 64,
            'frame': {'terrainInfo': f'{TILE_ID}.TerrainInfo0', 'location': [0, 0, 0], 'terrainScale': [1, 1, 1]},
            'anchor': {'playerStart': f'{TILE_ID}.PlayerStart0', 'location': [0, 0, 0]},
            'chunks': [{'chunkId': 'chunk-0-0', 'manifest': f'/l2/maps/{chunk_sha256}/native-tile-chunk-runtime/manifest.json',
                        'manifestSha256': chunk_sha256, 'manifestBytes': 100}],
            'resources': resources, 'gaps': []}


class MoverManifestResourceTests(unittest.TestCase):
    def test_a_sealed_movers_product_adds_one_movers_resource_that_the_vocabulary_admits(self):
        sha256 = 'f' * 64
        movers = {'manifest': {'resource': f'/l2/movers/{sha256}/tile-movers.json', 'sha256': sha256, 'bytes': 900}, 'gapRows': []}
        resources = tile_resources(None, movers)
        self.assertEqual(resources, [{'kind': 'movers', 'manifest': f'/l2/movers/{sha256}/tile-movers.json', 'manifestSha256': sha256, 'manifestBytes': 900}])
        validate_tile_manifest(tile_manifest_with(resources))
        self.assertIn('movers', load_tile_manifest_vocabulary().resource_kinds)
        with tempfile.TemporaryDirectory() as repository_without_vocabulary:
            with self.assertRaisesRegex(TileManifestError, 'vocabulary file missing'):
                validate_tile_manifest(tile_manifest_with(resources), load_tile_manifest_vocabulary(repository_without_vocabulary))

    def test_a_tile_without_movers_seals_the_step_and_writes_no_movers_resource(self):
        movers = {'manifest': None, 'gapRows': []}
        self.assertEqual(tile_resources(None, movers), [])
        self.assertNotIn(MOVER_STEP_NAME, pending_steps_after_sealed(PENDING_TILE_STEPS, None, None, None, movers))
        self.assertIn(MOVER_STEP_NAME, pending_steps_after_sealed(PENDING_TILE_STEPS, None, None, None, None))


def transformed(matrix, point):
    return [sum(matrix[column * 4 + row] * point[column] for column in range(3)) + matrix[12 + row] for row in range(3)]


class MoverResolutionTests(unittest.TestCase):
    def test_omitted_fixed_array_index_means_zero_and_duplicates_are_refused(self):
        tags = [{'name': 'KeyRot', 'arrayIndex': None, 'value': {'Yaw': 0}}, {'name': 'KeyRot', 'arrayIndex': 1, 'value': {'Yaw': -16384}}]
        properties = indexed_properties(tags)
        self.assertEqual(properties['KeyRot', 1]['value']['Yaw'], -16384)
        self.assertEqual(tags[0]['arrayIndex'], None)
        with self.assertRaisesRegex(FormatError, 'Duplicate'):
            indexed_properties(tags + [{'name': 'KeyRot', 'arrayIndex': 0}])
        with self.assertRaisesRegex(FormatError, 'outside declaration'):
            indexed_properties([{'name': 'KeyPos', 'arrayIndex': 8}])

    def test_nested_struct_field_does_not_override_actor_declaration(self):
        defaults = MoverDefaults({}, {'core.object': 'struct Test\n{\n\tvar Vector Location;\n};', 'engine.actor': 'var(Movement) const Vector Location;\n'})
        self.assertEqual(defaults.declaration('Location', 'Vector'), 'engine.actor')

    def test_omission_requires_a_real_native_field_declaration(self):
        defaults = MoverDefaults({'engine.mover': {'properties': {}}, 'engine.actor': {'properties': {}}, 'core.object': {'properties': {}}},
                                 {'engine.mover': 'var Rotator KeyRot[8];\n'})
        value = defaults.resolve({}, 'KeyRot', 'Rotator', 0, 8)
        self.assertEqual(value['value'], {'Pitch': 0, 'Yaw': 0, 'Roll': 0})
        self.assertEqual(value['source'], 'native-declared-field-zero-init')
        with self.assertRaisesRegex(FormatError, 'declaration unresolved'):
            defaults.resolve({}, 'BaseRot', 'Rotator')

    def test_endpoint_preserves_authored_pivot_and_single_unit_conversion(self):
        transforms = {name: {'value': value} for name, value in {
            'Location': {'X': 0, 'Y': 0, 'Z': 0}, 'Rotation': {'Pitch': 0, 'Yaw': 0, 'Roll': 0}, 'PrePivot': {'X': 100, 'Y': 0, 'Z': 0},
            'DrawScale': 1, 'DrawScale3D': {'X': 1, 'Y': 1, 'Z': 1}}.items()}
        matrix = endpoint_matrix({'X': 1000, 'Y': 2000, 'Z': 3000}, {'Pitch': 0, 'Yaw': 0, 'Roll': 0}, {'X': 0, 'Y': 0, 'Z': 0},
                                 {'Pitch': 0, 'Yaw': 16384, 'Roll': 0}, transforms)
        for actual, expected in zip(transformed(matrix, [1, 0, 0]), [10, 30, 20]):
            self.assertAlmostEqual(actual, expected)
        for actual, expected in zip(transformed(matrix, [2, 0, 0]), [10, 30, 21]):
            self.assertAlmostEqual(actual, expected)


@unittest.skipUnless((MOVER_CLASS_EVIDENCE / 'class-evidence.json').is_file(),
                     'needs the sealed class:Engine.Mover class-defaults unit (convert_tile.py --step movers on any tile)')
class SealedMoverClassEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.definitions = json.loads((MOVER_CLASS_EVIDENCE / 'class-evidence.json').read_text(encoding='utf-8'))
        cls.scripts = {name: (MOVER_CLASS_EVIDENCE / definition['sourceScript']).read_bytes() for name, definition in cls.definitions.items()}

    def read_script(self, name):
        return (MOVER_CLASS_EVIDENCE / name).read_bytes()

    def test_the_sealed_evidence_qualifies_and_recovers_the_native_mover_defaults(self):
        defaults = MoverDefaults(self.definitions, qualified_classes(self.definitions, self.read_script))
        self.assertEqual(defaults.resolve({}, 'MoveTime', 'float')['value'], 1)
        self.assertEqual(defaults.resolve({}, 'StayOpenTime', 'float')['value'], 4)
        self.assertIs(defaults.resolve({}, 'bClosed', 'bool')['value'], True)

    def test_changed_class_defaults_and_native_operators_are_rejected(self):
        definitions = copy.deepcopy(self.definitions)
        definitions['engine.mover']['properties']['MoveTime'] = 25
        with self.assertRaisesRegex(FormatError, 'disagree'):
            qualified_classes(definitions, self.read_script)
        changed = self.scripts['core.object'].replace(b'native(316)', b'native(999)')
        definitions = copy.deepcopy(self.definitions)
        definitions['core.object']['sourceScriptSha256'] = hashlib.sha256(changed).hexdigest()
        values = {definition['sourceScript']: self.scripts[name] for name, definition in definitions.items()}
        values[definitions['core.object']['sourceScript']] = changed
        with self.assertRaisesRegex(FormatError, 'endpoint semantics'):
            qualified_classes(definitions, lambda name: values[name])


def motion(num_keys=2, initial=0, closed=True, move_time=1.0):
    return {'NumKeys': {'value': num_keys}, 'KeyNum': {'value': initial}, 'bClosed': {'value': closed}, 'MoveTime': {'value': move_time}}


class RefusingDefaults:
    def resolve(self, properties, name, kind, index=None, count=None):
        raise FormatError('Native mover field declaration unresolved: ' + name)


class FakeMeshSources:
    def resolve(self, reference, expected):
        raise FormatError('Package missing/ambiguous: ' + reference)


class MoverUnsupportedTokenTests(unittest.TestCase):
    def test_the_token_list_is_the_closed_set_of_qualification_failures(self):
        self.assertEqual(MOVER_UNSUPPORTED_TOKENS, ('unconsumed-native-tail', 'key-count:<n>', 'initial-key:<n>', 'not-initially-closed',
                                                    'field-unresolved:<fieldName>', 'invalid-move-time', 'saved-placement-differs-from-initial-key',
                                                    'no-static-mesh', 'mesh-unresolved', 'non-rigid-key-transform', 'actor-scale'))
        with self.assertRaisesRegex(ValueError, 'not listed'):
            MoverUnsupportedError('door-is-blue')
        with self.assertRaisesRegex(ValueError, 'not listed'):
            MoverUnsupportedError('key-count')

    def test_each_qualification_failure_maps_to_exactly_one_token_and_a_listed_gap_reason(self):
        cases = {'key-count:3': motion(num_keys=3), 'initial-key:1': motion(initial=1), 'not-initially-closed': motion(closed=False),
                 'invalid-move-time': motion(move_time=0)}
        patterns = load_gap_reason_patterns()
        for token, resolved in cases.items():
            with self.assertRaises(MoverUnsupportedError) as raised:
                qualified_motion(resolved)
            self.assertEqual(raised.exception.token, token)
            self.assertTrue(any(pattern.fullmatch(raised.exception.reason) for pattern in patterns.values()), raised.exception.reason)
        self.assertEqual(qualified_motion(motion()), (2, 0, 1.0))
        with self.assertRaises(MoverUnsupportedError) as raised:
            resolved_field(RefusingDefaults(), {}, 'BasePos', 'Vector')
        self.assertEqual(raised.exception.reason, 'mover-unsupported:field-unresolved:BasePos')
        with self.assertRaises(MoverUnsupportedError) as raised:
            mover_mesh(FakeMeshSources(), {})
        self.assertEqual(raised.exception.token, 'no-static-mesh')
        with self.assertRaises(MoverUnsupportedError) as raised:
            mover_mesh(FakeMeshSources(), {('StaticMesh', None): {'value': {'object': 'missing_s.Door'}}})
        self.assertEqual(raised.exception.token, 'mesh-unresolved')

    def test_a_scaled_or_mirrored_key_transform_is_not_rigid(self):
        identity = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [5.0, 6.0, 7.0, 1.0]]
        self.assertTrue(is_rigid_rows(identity))
        self.assertFalse(is_rigid_rows([[2.0, 0.0, 0.0, 0.0], *identity[1:]]))
        self.assertFalse(is_rigid_rows([[-1.0, 0.0, 0.0, 0.0], *identity[1:]]))

    def test_a_rigid_key_on_a_scaled_or_mirrored_actor_names_the_actor_scale(self):
        origin, no_rotation, yaw = {'X': 0, 'Y': 0, 'Z': 0}, {'Pitch': 0, 'Yaw': 0, 'Roll': 0}, {'Pitch': 0, 'Yaw': 16384, 'Roll': 0}
        unit_transforms = {name: {'value': value} for name, value in {
            'Location': origin, 'Rotation': no_rotation, 'PrePivot': origin, 'DrawScale': 1.0,
            'DrawScale3D': {'X': 1.0, 'Y': 1.0, 'Z': 1.0}}.items()}
        patterns = load_gap_reason_patterns()
        scales = ((1.0, {'X': 1.0, 'Y': 1.0, 'Z': 1.02}), (1.0, {'X': -1.0, 'Y': 1.0, 'Z': 1.0}), (2.0, {'X': 1.0, 'Y': 1.0, 'Z': 1.0}))
        for draw_scale, draw_scale_3d in scales:
            transforms = {**unit_transforms, 'DrawScale': {'value': draw_scale}, 'DrawScale3D': {'value': draw_scale_3d}}
            self.assertFalse(is_rigid_rows(endpoint_source_rows(origin, no_rotation, origin, yaw, transforms)))
            token = non_rigid_key_token(origin, no_rotation, origin, yaw, transforms)
            self.assertEqual(token, 'actor-scale')
            self.assertTrue(any(pattern.fullmatch(MoverUnsupportedError(token).reason) for pattern in patterns.values()))
            self.assertEqual(transforms['DrawScale3D']['value'], draw_scale_3d)


def read_mover(export_index, mesh_object):
    return ReadMover({'exportIndex': export_index, 'object': f'{TILE_ID}.Mover{export_index}'}, {}, {'object': mesh_object}, {})


class MoverAccountingTests(unittest.TestCase):
    def test_a_mesh_package_outside_the_reviewed_layouts_gaps_its_movers_without_conversion(self):
        self.assertNotIn((1, 1), REVIEWED_VERSIONS)
        self.assertEqual(package_gate_reason({'packageVersion': 1, 'licensee': 1}), ('gap', 'static-material-layout-unreviewed:1/1'))
        conversion = MoverConversion(TILE_ID, {'path': f'maps/{TILE_ID}.unr', 'sha256': 'c' * 64}, 'work/tile__00_00/movers/receipt.json')
        door = converted('interlude:fixture_s.Door', 'fixture_s.Door')
        outcomes = {'fixture_s.Door': door, 'cruma_s.Gate': package_gate_reason({'packageVersion': 1, 'licensee': 1})}
        result = converted_movers([read_mover(3, 'fixture_s.Door'), read_mover(8, 'cruma_s.Gate')], outcomes, conversion)
        self.assertEqual([mover.item['exportIndex'] for mover, _ in result], [3])
        rows = conversion.gap_rows()
        self.assertEqual([(row['sourceIdentity']['object'], row['status'], row['reason']) for row in rows],
                         [(f'{TILE_ID}.Mover8', 'gap', 'static-material-layout-unreviewed:1/1')])
        for row in rows:
            validate_gap_row(row)

    def test_converted_plus_gapped_movers_must_equal_the_engine_mover_exports(self):
        items = [{'exportIndex': index} for index in (3, 8, 9)]
        door = converted('interlude:fixture_s.Door', 'fixture_s.Door')
        require_every_mover_classified(TILE_ID, items, [(read_mover(3, 'fixture_s.Door'), door)], [(8, {}), (9, {})])
        with self.assertRaisesRegex(MoverStepError, 'once each'):
            require_every_mover_classified(TILE_ID, items, [(read_mover(3, 'fixture_s.Door'), door)], [(8, {})])
        with self.assertRaisesRegex(MoverStepError, 'once each'):
            require_every_mover_classified(TILE_ID, items, [(read_mover(3, 'fixture_s.Door'), door)], [(3, {}), (8, {}), (9, {})])


def served_oracle_movers():
    oracle = json.loads(ORACLE_PATH.read_text(encoding='utf-8'))['movers']
    payload = (SERVED_STORE / 'movers' / oracle['manifestSha256'] / 'movers.json').read_bytes()
    if hashlib.sha256(payload).hexdigest() != oracle['manifestSha256']:
        raise AssertionError('served 20_20 mover manifest differs from the frozen oracle SHA-256')
    return oracle, json.loads(payload)


def sealed_tile_movers(tile_id):
    product = json.loads((LANE_FOLDER / 'work' / f'tile__{tile_id}' / MOVER_STEP_NAME / 'products' / 'movers.json').read_text(encoding='utf-8'))
    return product, json.loads((LANE_FOLDER / 'l2' / product['manifest']['resource'].removeprefix('/l2/')).read_text(encoding='utf-8'))


@unittest.skipUnless(REFERENCE_CLIENT.is_dir() and (LANE_FOLDER / 'work/tile__20_20/raw/complete.json').is_file()
                     and (LANE_FOLDER / 'work/tile__20_20/movers/complete.json').is_file(),
                     'needs the E: reference client and sealed 20_20 raw and movers units (convert_tile.py --map 20_20 --step movers)')
class OracleMoverSubsetTests(unittest.TestCase):
    def test_the_generic_step_yields_the_eight_oracle_movers_with_their_matrices_move_time_and_server_ids(self):
        oracle, served = served_oracle_movers()
        product, manifest = sealed_tile_movers('20_20')
        self.assertEqual(sorted(mover['id'] for mover in manifest['movers']), sorted(oracle['moverIds']))
        self.assertEqual([model['id'] for model in manifest['models']], oracle['modelIds'])
        self.assertEqual(product['exportCount'], 8)
        self.assertEqual(product['gapRows'], [])
        served_by_id = {mover['id']: mover for mover in served['movers']}
        for mover in manifest['movers']:
            reference = served_by_id[mover['id']]
            for field in ('closedMatrix', 'openMatrix', 'moveTimeSeconds', 'serverObject', 'actorName', 'modelId', 'initialKey', 'initiallyClosed'):
                self.assertEqual(mover[field], reference[field], f'{mover["id"]} {field}')
            self.assertEqual([(key['position']['value'], key['rotation']['value'], key['matrix']) for key in mover['keys']],
                             [(key['position']['value'], key['rotation']['value'], key['matrix']) for key in reference['keys']])
        self.assertEqual([mover['exportIndex'] for mover in manifest['movers']], sorted(mover['exportIndex'] for mover in manifest['movers']))
        served_models = {model['id']: model['model']['sha256'] for model in served['models']}
        self.assertEqual({model['id']: model['model']['sha256'] for model in manifest['models']}, served_models)
        self.assertEqual(set(manifest['classEvidence']), {'unit', 'evidenceSha256', 'classes'})

    def test_a_second_run_is_a_ledger_skip_that_keeps_the_sealed_manifest(self):
        first_row = run_mover_step(ROOT, REFERENCE_CLIENT, '20_20')
        product, _ = sealed_tile_movers('20_20')
        receipt = (LANE_FOLDER / 'work/tile__20_20/movers/receipt.json').read_bytes()
        second_row = run_mover_step(ROOT, REFERENCE_CLIENT, '20_20')
        self.assertEqual((second_row['step'], second_row['status']), (MOVER_STEP_NAME, 'pass'))
        self.assertEqual(second_row, first_row)
        self.assertEqual((LANE_FOLDER / 'work/tile__20_20/movers/receipt.json').read_bytes(), receipt)
        self.assertEqual(sealed_tile_movers('20_20')[0]['manifest'], product['manifest'])


if __name__ == '__main__':
    unittest.main()
