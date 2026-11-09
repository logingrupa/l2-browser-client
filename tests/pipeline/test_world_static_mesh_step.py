import copy
import hashlib
import json
from pathlib import Path
import random
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_assets_lib.gltf import json_bytes
from native_store.canonical_json import canonical_json_bytes
from native_store.gap_rows import load_gap_reason_patterns, validate_gap_row
from native_store.store_paths import lane_store_root, lane_work_root
from world import static_mesh_step
from world.static_mesh_step import (STATIC_MESH_STEP_ALGORITHM_VERSION, ConvertedStaticMesh, StaticMeshAssignment, StaticMeshUnit,
                                    assign_static_placements, placeable_requests, placement_accounting_difference, run_static_mesh_step,
                                    static_mesh_ledger, static_mesh_outcomes, static_meshes_product)
from world.freeze_world_oracle import matrix_canonical_sha256
from world.native_terrain_sectors import native_terrain
from world.raw_map_step import read_tile_map_lock_record
from world.static_placement import gltf_placement, read_class_evidence, resolved_static_values, static_matrix
from world.static_placement_plan import chunk_for_origin, chunk_rectangles, plan_static_placements
from world.terrain_chunk_step import TERRAIN_CLASS_EVIDENCE_FOLDER
from world.tile_chunk_plan import ChunkPlanStepError, native_sector_axes, read_locked_map_package, tile_chunk_records
from world.tile_manifest_step import build_tile_chunk_manifest, tile_store_files
from synthetic_terrain_fixture import synthetic_native_terrain

TILE_ID = '00_00'
SOURCE_IDENTITY = {'path': f'maps/{TILE_ID}.unr', 'sha256': hashlib.sha256(b'synthetic static mesh tile').hexdigest()}
EVIDENCE = f'work/tile__{TILE_ID}/meshes/receipt.json'
SECTOR_SPACING = 128.0
CHUNK_EDGE = 1024.0
TILE_EDGE = 2048.0
REFERENCE_CLIENT = Path('E:/Lineage2-client')
ORACLE_TILE_ID = '20_20'
ORACLE_PATH = ROOT / 'recipes/world/oracle/20_20/expected.json'
UNRESOLVED_COLLISION = {'bBlockActors': {'status': 'omitted-class-default-unresolved'}}
CLASS_EVIDENCE = {'Engine.Actor': {'defaults': {'DrawScale': 1.0, 'DrawScale3D': {'X': 1.0, 'Y': 1.0, 'Z': 1.0}}, 'superClass': 'Object'},
                  'Engine.StaticMeshActor': {'defaults': {}, 'superClass': 'Actor'}}


def synthetic_native():
    native = synthetic_native_terrain(8, 8)
    native['toWorld'] = {'origin': [0.0, 0.0, 0.0], 'axes': [[SECTOR_SPACING, 0, 0], [0, SECTOR_SPACING, 0], [0, 0, 1.0]]}
    return native


def synthetic_chunk_plan(native):
    return {'tileId': TILE_ID, 'chunks': tile_chunk_records(native, *native_sector_axes(native))}


def static_mesh_actor(export_index, mesh, x, y, *, overrides=(), draw_scale=None, class_object='Engine.StaticMeshActor'):
    transform = {name: {'status': 'omitted-class-default-unresolved'} for name in ('Rotation', 'PrePivot', 'DrawScale', 'DrawScale3D')}
    transform['Location'] = {'status': 'serialized', 'value': {'X': x, 'Y': y, 'Z': 50.0}}
    if draw_scale is not None:
        transform['DrawScale'] = {'status': 'serialized', 'value': draw_scale}
    return {'id': f'interlude:{TILE_ID}.StaticMeshActor{export_index}', 'object': f'{TILE_ID}.StaticMeshActor{export_index}',
            'classObject': class_object, 'exportIndex': export_index, 'staticMesh': None if mesh is None else {'index': -1, 'object': mesh},
            'materialOverrides': list(overrides), 'collision': UNRESOLVED_COLLISION, 'sourceTransform': transform}


def mesh_request(package, name):
    return {'kind': 'model', 'package': f'staticmeshes/{package}.usx', 'object': f'{package}.{name}'}


def converted_mesh(package, name):
    payload = f'synthetic archive {package}.{name}'.encode()
    archive_sha256 = hashlib.sha256(payload).hexdigest()
    glb = f'synthetic model {package}.{name}'.encode()
    store_files = {f'{archive_sha256}/asset.l2asset': (f'{archive_sha256}/asset.l2asset', payload),
                   f'{archive_sha256}/model.glb': (f'{archive_sha256}/model.glb', glb)}
    record = {'id': f'interlude:{package}.{name}', 'sourceObject': f'{package}.{name}',
              'archive': {'file': f'{archive_sha256}/asset.l2asset', 'sha256': archive_sha256, 'bytes': len(payload)},
              'model': {'file': f'{archive_sha256}/model.glb', 'sha256': hashlib.sha256(glb).hexdigest(), 'bytes': len(glb)}}
    return ConvertedStaticMesh(record, store_files)


class ChunkForOriginTests(unittest.TestCase):
    def setUp(self):
        native = synthetic_native()
        self.rectangles = chunk_rectangles(synthetic_chunk_plan(native), native)

    def test_rectangles_follow_the_native_sector_quads_through_the_terrain_frame(self):
        self.assertEqual([(rectangle.chunk_id, rectangle.minimum, rectangle.maximum) for rectangle in self.rectangles], [
            ('chunk-0-0', (0.0, 0.0), (CHUNK_EDGE, CHUNK_EDGE)), ('chunk-0-1', (0.0, CHUNK_EDGE), (CHUNK_EDGE, TILE_EDGE)),
            ('chunk-1-0', (CHUNK_EDGE, 0.0), (TILE_EDGE, CHUNK_EDGE)), ('chunk-1-1', (CHUNK_EDGE, CHUNK_EDGE), (TILE_EDGE, TILE_EDGE))])

    def test_an_origin_on_a_shared_edge_belongs_to_the_chunk_whose_minimum_equals_it(self):
        self.assertEqual(chunk_for_origin(self.rectangles, CHUNK_EDGE, 10.0), 'chunk-1-0')
        self.assertEqual(chunk_for_origin(self.rectangles, 10.0, CHUNK_EDGE), 'chunk-0-1')
        self.assertEqual(chunk_for_origin(self.rectangles, CHUNK_EDGE, CHUNK_EDGE), 'chunk-1-1')
        self.assertEqual(chunk_for_origin(self.rectangles, CHUNK_EDGE - 0.5, 10.0), 'chunk-0-0')

    def test_an_origin_outside_every_chunk_has_no_chunk(self):
        for origin in ((TILE_EDGE, 10.0), (10.0, TILE_EDGE), (-0.5, 10.0), (10.0, -0.5)):
            with self.subTest(origin=origin):
                self.assertIsNone(chunk_for_origin(self.rectangles, *origin))


class PlanStaticPlacementsTests(unittest.TestCase):
    def setUp(self):
        native = synthetic_native()
        self.rectangles = chunk_rectangles(synthetic_chunk_plan(native), native)

    def test_placements_keep_export_order_and_the_source_matrix_without_a_z_window(self):
        actors = [static_mesh_actor(9, 'Rock_S.Rock', 100.0, 100.0), static_mesh_actor(3, 'Rock_S.Rock', 1500.0, 100.0),
                  static_mesh_actor(5, 'Tree_S.Tree', 110.0, 120.0)]
        actors[1]['sourceTransform']['Location']['value']['Z'] = -90000.0
        plan = plan_static_placements(list(reversed(actors)), self.rectangles, CLASS_EVIDENCE)
        self.assertEqual([placement['exportIndex'] for placement in plan.placements_by_chunk['chunk-0-0']], [5, 9])
        self.assertEqual([placement['exportIndex'] for placement in plan.placements_by_chunk['chunk-1-0']], [3])
        self.assertEqual(plan.placements_by_chunk['chunk-1-1'], [])
        placement = plan.placements_by_chunk['chunk-1-0'][0]
        self.assertEqual(placement['matrix'], gltf_placement(static_matrix(resolved_static_values(actors[1], CLASS_EVIDENCE))))
        self.assertEqual(placement['matrix'][12:], [15.0, -900.0, 1.0, 1])
        self.assertEqual(set(placement), {'id', 'sourceActor', 'exportIndex', 'sourceMesh', 'matrix', 'materialOverrides', 'collision'})

    def test_outside_grid_and_singular_actors_are_rows_and_other_classes_are_not_placements(self):
        actors = [static_mesh_actor(1, 'Rock_S.Rock', TILE_EDGE + 1, 5.0), static_mesh_actor(2, 'Rock_S.Rock', 5.0, 5.0, draw_scale=0.0),
                  static_mesh_actor(3, None, 5.0, 5.0), static_mesh_actor(4, 'Rock_S.Rock', 5.0, 5.0, class_object='Engine.Mover')]
        plan = plan_static_placements(actors, self.rectangles, CLASS_EVIDENCE)
        self.assertEqual([(entry.placement['exportIndex'], entry.status, entry.reason) for entry in plan.unplaced], [
            (1, 'gap', 'placement-outside-chunk-grid'), (2, 'failed', 'decode-failed:FormatError:Singular static actor scale')])
        self.assertTrue(all(not placements for placements in plan.placements_by_chunk.values()))


class RecordingConverter:
    instances = []

    def __init__(self, client, output, umodel, *, project_root):
        self.output, self.requests = output, []
        RecordingConverter.instances.append(self)

    def convert(self, request):
        self.requests.append(request)
        if request['object'].endswith('Broken'):
            raise ValueError('UModel cannot safely select this duplicate leaf name\nsecond line')
        if request['object'].endswith('Payload'):
            raise ValueError(f'Expected exactly one exported payload for {request["object"]}: [{self.output}/export/a.gltf]')
        if request['object'].endswith('Hung'):
            raise ValueError(f'UModel failed or reported an error; inspect {self.output}/000-export.log')
        return {'file': str(self.output / 'asset.l2asset')}


def synthetic_store_record(record_id, archive_path):
    converted = converted_mesh('Rock_S', Path(archive_path).parent.name or 'Rock')
    record = converted.model_record
    return converted.store_files, {'assetId': record['id'], 'source': {'object': record['sourceObject']},
                                   'archive': '/l2/' + record['archive']['file'], 'archiveSha256': record['archive']['sha256'],
                                   'model': '/l2/' + record['model']['file'], 'modelSha256': record['model']['sha256']}


class StaticMeshOutcomeTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name)
        RecordingConverter.instances = []

    def outcomes(self, headers, requests):
        def header(_, package):
            return headers[package]
        with patch.object(static_mesh_step, 'Converter', RecordingConverter), \
                patch.object(static_mesh_step, 'read_package_header', side_effect=header), \
                patch.object(static_mesh_step, 'require_reference_client'), \
                patch.object(static_mesh_step, 'converted_model_store_files_and_record', side_effect=synthetic_store_record):
            return static_mesh_outcomes(self.project_root, Path('E:/Lineage2-client'), requests)

    def test_an_unreviewed_static_material_layout_is_a_gap_and_never_reaches_the_converter(self):
        requests = [mesh_request('Old_S', 'Rock'), mesh_request('Old_S', 'Tree')]
        outcomes = self.outcomes({'staticmeshes/Old_S.usx': {'packageVersion': 123, 'licensee': 12}}, requests)
        self.assertEqual(outcomes, {'Old_S.Rock': ('gap', 'static-material-layout-unreviewed:123/12'),
                                    'Old_S.Tree': ('gap', 'static-material-layout-unreviewed:123/12')})
        self.assertEqual(RecordingConverter.instances, [])

    def test_a_reviewed_layout_converts_once_per_mesh_with_the_model_request_and_a_failure_is_a_failed_outcome(self):
        requests = [mesh_request('Rock_S', 'Rock'), mesh_request('Rock_S', 'Broken'), mesh_request('Bad_S', 'Rock')]
        outcomes = self.outcomes({'staticmeshes/Rock_S.usx': {'packageVersion': 123, 'licensee': 28},
                                  'staticmeshes/Bad_S.usx': {'error': 'header too short'}}, requests)
        self.assertEqual(len(RecordingConverter.instances), 1)
        converter = RecordingConverter.instances[0]
        self.assertEqual(converter.requests, [{'kind': 'model', 'package': 'staticmeshes/Rock_S.usx', 'object': 'Rock_S.Rock'},
                                              {'kind': 'model', 'package': 'staticmeshes/Rock_S.usx', 'object': 'Rock_S.Broken'}])
        self.assertEqual(converter.output, lane_work_root(self.project_root, 'world') / 'static-mesh-converter')
        self.assertIsInstance(outcomes['Rock_S.Rock'], ConvertedStaticMesh)
        self.assertEqual(outcomes['Rock_S.Broken'], ('failed', 'decode-failed:ValueError:UModel cannot safely select this duplicate leaf name'))
        self.assertEqual(outcomes['Bad_S.Rock'], ('failed', 'decode-failed:header too short'))

    def test_a_failure_reason_keeps_the_sentence_and_drops_machine_paths(self):
        requests = [mesh_request('Rock_S', 'Payload'), mesh_request('Rock_S', 'Hung')]
        outcomes = self.outcomes({'staticmeshes/Rock_S.usx': {'packageVersion': 123, 'licensee': 28}}, requests)
        self.assertEqual(outcomes, {'Rock_S.Payload': ('failed', 'decode-failed:ValueError:Expected exactly one exported payload for Rock_S.Payload'),
                                    'Rock_S.Hung': ('failed', 'decode-failed:ValueError:UModel failed or reported an error')})


def synthetic_tile_actors():
    return [static_mesh_actor(10, 'Rock_S.Rock', 100.0, 100.0), static_mesh_actor(11, 'rock_s.rock', CHUNK_EDGE, 100.0),
            static_mesh_actor(12, 'Tree_S.Tree', 200.0, 1500.0), static_mesh_actor(13, 'Rock_S.Rock', 300.0, 300.0, overrides=[{'name': 'Skins'}]),
            static_mesh_actor(14, 'Lost_S.Lost', 400.0, 400.0), static_mesh_actor(15, 'Old_S.Rock', 500.0, 500.0),
            static_mesh_actor(16, 'Rock_S.Broken', 600.0, 600.0), static_mesh_actor(17, 'Rock_S.Rock', TILE_EDGE + 5, 5.0),
            static_mesh_actor(18, None, 5.0, 5.0)]


def synthetic_requests_by_reference():
    return {'Rock_S.Rock': mesh_request('Rock_S', 'Rock'), 'rock_s.rock': mesh_request('Rock_S', 'Rock'),
            'Tree_S.Tree': mesh_request('Tree_S', 'Tree'), 'Old_S.Rock': mesh_request('Old_S', 'Rock'), 'Rock_S.Broken': mesh_request('Rock_S', 'Broken')}


def synthetic_outcomes():
    return {'Rock_S.Rock': converted_mesh('Rock_S', 'Rock'), 'Tree_S.Tree': converted_mesh('Tree_S', 'Tree'),
            'Old_S.Rock': ('gap', 'static-material-layout-unreviewed:123/12'),
            'Rock_S.Broken': ('failed', 'decode-failed:ValueError:UModel cannot safely select this duplicate leaf name')}


class StaticMeshAssignmentTests(unittest.TestCase):
    def setUp(self):
        native = synthetic_native()
        self.chunk_plan = synthetic_chunk_plan(native)
        self.plan = plan_static_placements(synthetic_tile_actors(), chunk_rectangles(self.chunk_plan, native), CLASS_EVIDENCE)

    def assignment(self):
        return assign_static_placements(self.plan, synthetic_requests_by_reference(), synthetic_outcomes(),
                                        StaticMeshAssignment(TILE_ID, SOURCE_IDENTITY, EVIDENCE))

    def test_only_placeable_meshes_are_requested_once_each_in_casefold_order(self):
        self.assertEqual([request['object'] for request in placeable_requests(self.plan, synthetic_requests_by_reference())],
                         ['Old_S.Rock', 'Rock_S.Broken', 'Rock_S.Rock', 'Tree_S.Tree'])

    def test_every_static_mesh_actor_with_a_mesh_is_placed_once_or_is_one_gap_row(self):
        assignment = self.assignment()
        placed = {placement['exportIndex'] for placements in assignment.placed_by_chunk.values() for placement in placements}
        gapped = {int(row['sourceIdentity']['object'].removeprefix(f'{TILE_ID}.StaticMeshActor')) for row in assignment.gap_rows()}
        self.assertEqual(placed, {10, 11, 12})
        self.assertEqual(gapped, {13, 14, 15, 16, 17})
        self.assertFalse(placed & gapped)
        self.assertIsNone(placement_accounting_difference(synthetic_tile_actors(), assignment))
        self.assertEqual(placement_accounting_difference([*synthetic_tile_actors(), static_mesh_actor(19, 'Rock_S.Rock', 1.0, 1.0)], assignment),
                         '8 placed or gapped of 9 StaticMeshActor exports with a StaticMesh reference')

    def test_each_gap_row_names_its_listed_reason_and_object(self):
        rows = self.assignment().gap_rows()
        patterns = load_gap_reason_patterns()
        for row in rows:
            validate_gap_row(row, patterns)
        self.assertEqual([(row['sourceIdentity']['object'], row['status'], row['reason']) for row in rows], [
            (f'{TILE_ID}.StaticMeshActor13', 'gap', 'placement-material-override-unsupported'),
            (f'{TILE_ID}.StaticMeshActor14', 'gap', 'static-mesh-reference-unresolved'),
            (f'{TILE_ID}.StaticMeshActor15', 'gap', 'static-material-layout-unreviewed:123/12'),
            (f'{TILE_ID}.StaticMeshActor16', 'failed', 'decode-failed:ValueError:UModel cannot safely select this duplicate leaf name'),
            (f'{TILE_ID}.StaticMeshActor17', 'gap', 'placement-outside-chunk-grid')])

    def test_the_product_sorts_models_by_source_object_and_placements_by_export_index_and_lists_every_chunk(self):
        product = static_meshes_product(TILE_ID, self.chunk_plan, self.assignment(), synthetic_outcomes())
        self.assertEqual([model['sourceObject'] for model in product['models']], ['Rock_S.Rock', 'Tree_S.Tree'])
        self.assertEqual(list(product['chunks']), ['chunk-0-0', 'chunk-0-1', 'chunk-1-0', 'chunk-1-1'])
        chunk = product['chunks']['chunk-0-0']
        self.assertEqual([(model['id'], [placement['exportIndex'] for placement in model['placements']]) for model in chunk['models']],
                         [('interlude:Rock_S.Rock', [10])])
        self.assertEqual(product['chunks']['chunk-1-0']['models'][0]['placements'][0]['modelId'], 'interlude:Rock_S.Rock')
        self.assertEqual(product['chunks']['chunk-1-1'], {'models': [], 'gapRows': []})
        self.assertEqual([row['sourceIdentity']['object'] for row in product['unplacedGapRows']], [f'{TILE_ID}.StaticMeshActor17'])
        self.assertEqual(json_bytes(product), json_bytes(static_meshes_product(TILE_ID, self.chunk_plan, self.assignment(), synthetic_outcomes())))

    def test_a_shuffled_actor_list_writes_the_same_product(self):
        native = synthetic_native()
        shuffled = synthetic_tile_actors()
        random.Random(29).shuffle(shuffled)
        plan = plan_static_placements(shuffled, chunk_rectangles(self.chunk_plan, native), CLASS_EVIDENCE)
        assignment = assign_static_placements(plan, synthetic_requests_by_reference(), synthetic_outcomes(),
                                              StaticMeshAssignment(TILE_ID, SOURCE_IDENTITY, EVIDENCE))
        self.assertEqual(json_bytes(static_meshes_product(TILE_ID, self.chunk_plan, assignment, synthetic_outcomes())),
                         json_bytes(static_meshes_product(TILE_ID, self.chunk_plan, self.assignment(), synthetic_outcomes())))


def terrain_records(chunk_plan):
    return [{'chunkId': chunk['chunkId'], 'terrain': None, 'maskUvRule': 'extrapolated', 'gapRows': []} for chunk in chunk_plan['chunks']]


class ChunkManifestStaticMeshTests(unittest.TestCase):
    def setUp(self):
        native = synthetic_native()
        self.chunk_plan = synthetic_chunk_plan(native)
        self.chunk_plan.update(frame={'terrainInfo': 'Fixture.TerrainInfo0', 'location': [0.0, 0.0, 0.0], 'terrainScale': [128.0, 128.0, 76.0]},
                               anchor={'playerStart': 'Fixture.PlayerStart0', 'location': [1.0, 1.0, 1.0]})
        plan = plan_static_placements(synthetic_tile_actors(), chunk_rectangles(self.chunk_plan, native), CLASS_EVIDENCE)
        assignment = assign_static_placements(plan, synthetic_requests_by_reference(), synthetic_outcomes(),
                                              StaticMeshAssignment(TILE_ID, SOURCE_IDENTITY, EVIDENCE))
        self.product = static_meshes_product(TILE_ID, self.chunk_plan, assignment, synthetic_outcomes())

    def chunk_manifest(self, index, static_meshes):
        chunk = self.chunk_plan['chunks'][index]
        return build_tile_chunk_manifest(TILE_ID, terrain_records(self.chunk_plan)[index], chunk, SOURCE_IDENTITY, EVIDENCE, static_meshes)

    def test_sealed_meshes_fill_the_chunk_models_and_keep_one_meshes_row_only_for_a_gapped_chunk(self):
        gapped = self.chunk_manifest(0, self.product)
        self.assertEqual([model['id'] for model in gapped['models']], ['interlude:Rock_S.Rock'])
        self.assertEqual(gapped['models'][0]['archive'], f'/l2/{gapped["models"][0]["archiveSha256"]}/asset.l2asset')
        meshes_rows = [row for row in gapped['gaps'] if row['step'] == 'meshes']
        self.assertEqual([(row['status'], row['reason']) for row in meshes_rows], [('gap', 'placement-material-override-unsupported')])
        clean = self.chunk_manifest(3, self.product)
        self.assertEqual(clean['models'], [])
        self.assertNotIn('meshes', [row['step'] for row in clean['gaps']])

    def test_an_unsealed_meshes_step_keeps_the_pending_meshes_row_and_no_models(self):
        manifest = self.chunk_manifest(0, None)
        self.assertEqual(manifest['models'], [])
        self.assertIn(('meshes', 'pending', 'step-pending:meshes'), [(row['step'], row['status'], row['reason']) for row in manifest['gaps']])

    def test_the_tile_manifest_names_the_meshes_gap_instead_of_the_pending_row(self):
        files, _ = tile_store_files(TILE_ID, SOURCE_IDENTITY, self.chunk_plan, terrain_records(self.chunk_plan), {}, EVIDENCE, self.product)
        tile = json.loads(next(payload for path, payload in files.items() if path.startswith('tiles/')))
        self.assertEqual([(row['status'], row['reason']) for row in tile['gaps'] if row['step'] == 'meshes'],
                         [('gap', 'placement-material-override-unsupported')])

    def test_two_builds_write_byte_identical_chunk_manifests(self):
        first, _ = tile_store_files(TILE_ID, SOURCE_IDENTITY, self.chunk_plan, terrain_records(self.chunk_plan), {}, EVIDENCE, self.product)
        second, _ = tile_store_files(TILE_ID, SOURCE_IDENTITY, self.chunk_plan, terrain_records(self.chunk_plan), {}, EVIDENCE,
                                     copy.deepcopy(self.product))
        self.assertEqual(first, second)


class RunStaticMeshStepTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name)
        self.raw_products = self.project_root / 'raw-products'
        self.raw_products.mkdir()
        native = synthetic_native()
        self.native, self.chunk_plan = native, synthetic_chunk_plan(native)

    def run_step(self, actors, outcomes):
        (self.raw_products / 'actors.json').write_bytes(json_bytes(actors))
        ledger = static_mesh_ledger(self.project_root)
        inputs = [SOURCE_IDENTITY]
        config = {'chunksFingerprint': 'c' * 64, 'converterSha256': 'd' * 64}
        unit = StaticMeshUnit(ledger, f'tile:{TILE_ID}', ledger.unit_fingerprint([SOURCE_IDENTITY['sha256']], config), config, inputs,
                              self.chunk_plan, self.raw_products, synthetic_requests_by_reference())
        with patch.object(static_mesh_step, 'read_tile_map_lock_record', return_value={'eSha256': SOURCE_IDENTITY['sha256']}), \
                patch.object(static_mesh_step, 'static_mesh_unit', return_value=unit), \
                patch.object(static_mesh_step, 'read_locked_map_package'), \
                patch.object(static_mesh_step, 'native_terrain', return_value=self.native), \
                patch.object(static_mesh_step, 'read_class_evidence', return_value=CLASS_EVIDENCE), \
                patch.object(static_mesh_step, 'static_mesh_outcomes', return_value=outcomes) as converted:
            row = run_static_mesh_step(self.project_root, Path('E:/Lineage2-client'), TILE_ID)
        return row, converted.call_count, ledger.unit_step_directory(unit.unit_key)

    def lane_snapshot(self):
        return {path.relative_to(self.project_root).as_posix(): (path.read_bytes(), path.stat().st_mtime_ns)
                for path in sorted((self.project_root / 'artifacts').rglob('*')) if path.is_file()}

    def test_the_step_seals_the_product_writes_the_models_into_the_world_lane_store_and_summarises_the_gaps(self):
        row, conversions, step_directory = self.run_step(synthetic_tile_actors(), synthetic_outcomes())
        self.assertEqual((row['step'], row['status'], row['reason']), ('meshes', 'gap', 'placement-material-override-unsupported'))
        self.assertEqual(conversions, 1)
        self.assertTrue((step_directory / 'complete.json').is_file())
        receipt = json.loads((step_directory / 'receipt.json').read_text(encoding='utf-8'))
        self.assertEqual(receipt['algorithmVersion'], STATIC_MESH_STEP_ALGORITHM_VERSION)
        self.assertEqual(len(receipt['gapRows']), 5)
        store_root = lane_store_root(self.project_root, 'world')
        product = json.loads((step_directory / 'products/static-meshes.json').read_text(encoding='utf-8'))
        for model in product['models']:
            self.assertTrue((store_root / model['archive']['file']).is_file())
            self.assertTrue((store_root / model['model']['file']).is_file())
        self.assertFalse((store_root / 'catalog.json').exists())
        self.assertEqual(sorted(output['path'].split('/')[0] for output in receipt['outputs']), ['l2', 'l2', 'l2', 'l2', 'work'])

    def test_a_second_run_is_a_ledger_skip_and_a_forced_rebuild_writes_the_same_product(self):
        first_row, _, step_directory = self.run_step(synthetic_tile_actors(), synthetic_outcomes())
        before = self.lane_snapshot()
        second_row, conversions, _ = self.run_step(synthetic_tile_actors(), synthetic_outcomes())
        self.assertEqual((second_row, conversions), (first_row, 0))
        self.assertEqual(self.lane_snapshot(), before)
        product_before = (step_directory / 'products/static-meshes.json').read_bytes()
        (step_directory / 'complete.json').unlink()
        rebuilt_row, conversions, _ = self.run_step(synthetic_tile_actors(), synthetic_outcomes())
        self.assertEqual((rebuilt_row, conversions), (first_row, 1))
        self.assertEqual((step_directory / 'products/static-meshes.json').read_bytes(), product_before)

    def test_a_tile_without_static_mesh_actors_seals_a_pass_with_empty_chunks(self):
        row, _, step_directory = self.run_step([static_mesh_actor(1, None, 5.0, 5.0)], {})
        self.assertEqual((row['status'], row['reason']), ('pass', None))
        product = json.loads((step_directory / 'products/static-meshes.json').read_text(encoding='utf-8'))
        self.assertEqual(product['models'], [])
        self.assertTrue(all(chunk == {'models': [], 'gapRows': []} for chunk in product['chunks'].values()))
        manifest = build_tile_chunk_manifest(TILE_ID, terrain_records(self.chunk_plan)[0], self.chunk_plan['chunks'][0], SOURCE_IDENTITY,
                                             EVIDENCE, product)
        self.assertEqual(canonical_json_bytes(manifest)[:1], b'{')
        self.assertEqual(manifest['models'], [])

    def test_an_accounting_difference_is_a_failed_step_row_and_seals_nothing(self):
        with patch.object(static_mesh_step, 'placement_accounting_difference', return_value='1 placed or gapped of 2'):
            row, _, step_directory = self.run_step(synthetic_tile_actors(), synthetic_outcomes())
        self.assertEqual((row['status'], row['reason']), ('failed', 'decode-failed:placement accounting: 1 placed or gapped of 2'))
        self.assertFalse((step_directory / 'complete.json').exists())


class OracleSectionSubsetTests(unittest.TestCase):
    def oracle_section_manifest(self, oracle_section):
        manifest_path = ROOT / 'public/l2/maps' / oracle_section['manifestSha256'] / 'map-section-runtime/manifest.json'
        if not manifest_path.is_file():
            self.skipTest(f'the oracle section manifest is not served under public/l2: {manifest_path}')
        payload = manifest_path.read_bytes()
        if hashlib.sha256(payload).hexdigest() != oracle_section['manifestSha256']:
            self.skipTest('the served oracle section manifest differs from the pinned oracle SHA-256')
        manifest = json.loads(payload)
        placements = {placement['id']: placement for placement in manifest['placements']}
        for oracle_placement in oracle_section['placements']:
            self.assertEqual(matrix_canonical_sha256(placements[oracle_placement['id']]['matrix']), oracle_placement['matrixCanonicalSha256'])
        return placements

    def generic_plan(self):
        if not REFERENCE_CLIENT.is_dir():
            self.skipTest(f'the reference client {REFERENCE_CLIENT} is absent')
        lock_record = read_tile_map_lock_record(ORACLE_TILE_ID)
        try:
            unit = static_mesh_step.static_mesh_unit(ROOT, ORACLE_TILE_ID, lock_record)
        except ChunkPlanStepError as error:
            self.skipTest(f'the {ORACLE_TILE_ID} raw and chunk plan units are not sealed: {error}')
        actors = json.loads((unit.raw_products / 'actors.json').read_text(encoding='utf-8'))
        rectangles = chunk_rectangles(unit.chunk_plan, native_terrain(read_locked_map_package(REFERENCE_CLIENT, ORACLE_TILE_ID, lock_record)))
        evidence_folder = lane_work_root(ROOT, 'world') / TERRAIN_CLASS_EVIDENCE_FOLDER
        return unit, plan_static_placements(actors, rectangles, read_class_evidence(REFERENCE_CLIENT, evidence_folder, evidence_folder))

    def test_the_generic_20_20_plan_holds_every_oracle_placement_with_its_mesh_and_rotation_scale(self):
        oracle_section = json.loads(ORACLE_PATH.read_text(encoding='utf-8'))['section']
        served = self.oracle_section_manifest(oracle_section)
        unit, plan = self.generic_plan()
        placed = {placement['id']: placement for placements in plan.placements_by_chunk.values() for placement in placements}
        self.assertEqual([placement['id'] for placement in oracle_section['placements'] if placement['id'] not in placed], [])
        translation_differences = set()
        for oracle_placement in oracle_section['placements']:
            generic, source = placed[oracle_placement['id']], served[oracle_placement['id']]['matrix']
            self.assertEqual(generic['sourceMesh'], oracle_placement['sourceMesh'])
            self.assertEqual([generic['matrix'][column:column + 3] for column in (0, 4, 8)], [source[column:column + 3] for column in (0, 4, 8)])
            translation_differences.add(tuple(served_value - generic_value for served_value, generic_value in zip(source[12:15], generic['matrix'][12:15])))
        self.assertEqual(len(translation_differences), 1)
        requested = {request['object'].casefold() for request in unit.requests_by_reference.values()}
        self.assertEqual([model['sourceObject'] for model in oracle_section['models'] if model['sourceObject'].casefold() not in requested], [])


if __name__ == '__main__':
    unittest.main()
