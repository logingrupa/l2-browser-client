import hashlib
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from actors import actor_material_programs
from actors.actor_arguments import actor_model_key_argument
from actors.actor_material_programs import (MATERIAL_PROGRAMS_STEP, ActorMaterialProgramError, actor_material_object_inventory,
                                            convert_actor_material_programs, material_program_listing, model_records_of_catalog_key,
                                            model_slot_source_objects)
from native_assets_lib.gltf import json_bytes
from native_store.catalog_writer import merge_catalog_slice, pinned_file_references, read_store_catalog, validate_catalog_record
from native_store.verified_file_writes import CatalogWriteError
from native_store.store_paths import lane_store_root, lane_work_root
from native_store.unit_ledger import UnitLedger
from support.synthetic_texture_sources import use_synthetic_textures_without_a_native_body
from synthetic_class_scripts import scratch_work_root
from test_material_graph import SYNTHETIC_CLASS_DEFAULTS
from test_material_program_images import synthetic_png_bytes
from test_static_mesh_materials_step import MISSING_MATERIAL, TEXTURED_MATERIAL, TEXTURED_MATERIAL_TEXTURE, UNPORTED_MATERIAL, synthetic_map_sources
from world import material_texture_images, surface_material_programs
from world.surface_material_programs import MaterialProgramOutcome, WorldMaterialSources

CONVERTER_SHA256 = 'c' * 64
UNPORTED_MATERIAL_TEXTURE = 'SyntheticUnported.PlainTexture'
LOCKED_PACKAGE_SHA256 = 'a' * 64


def graph_slot(material_object):
    return {'sourceReference': material_object.split('.')[0] + '.ShortName', 'nativeMaterialGraph': [{'object': material_object}],
            'texture': 'Synthetic.Leaf'}


def synthetic_model_archive(metadata):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr('provenance.json', json.dumps({'metadata': metadata}))
    return output.getvalue()


class ActorMaterialProgramTests(unittest.TestCase):
    def setUp(self):
        use_synthetic_textures_without_a_native_body(self)
        self.project_root = scratch_work_root(self, 'actor-material-programs-project-')
        self.store_root = lane_store_root(self.project_root, 'actors')
        self.store_root.mkdir(parents=True)
        self.converted_textures = []

        def texture(work, reference):
            self.converted_textures.append(reference)
            return synthetic_png_bytes(), {}, reference

        self.converter = SimpleNamespace(output=scratch_work_root(self, 'actor-material-programs-converter-'), texture=texture)
        self.sources = WorldMaterialSources(synthetic_map_sources(), self.converter, lane_work_root(self.project_root, 'actors'), None, self.store_root)
        material_texture_images.stored_texture_images_by_store_root.clear()
        self.addCleanup(material_texture_images.stored_texture_images_by_store_root.clear)
        self.preflights = []
        for active in (patch.object(actor_material_programs, 'actor_material_sources', return_value=self.sources),
                       patch.object(actor_material_programs, 'implementation_hash', return_value=CONVERTER_SHA256),
                       patch.object(actor_material_programs, 'locked_input_records',
                                    side_effect=lambda paths: [{'path': path, 'sha256': LOCKED_PACKAGE_SHA256} for path in paths]),
                       patch.object(surface_material_programs, 'kept_material_class_defaults', return_value=SYNTHETIC_CLASS_DEFAULTS)):
            active.start()
            self.addCleanup(active.stop)

    def stage_models(self, records_and_metadata):
        models = []
        for record_id, metadata in records_and_metadata:
            archive = synthetic_model_archive(metadata)
            sha256 = hashlib.sha256(archive).hexdigest()
            (self.store_root / sha256).mkdir(exist_ok=True)
            (self.store_root / sha256 / 'asset.l2asset').write_bytes(archive)
            models.append({'id': record_id, 'archive': f'/l2/{sha256}/asset.l2asset', 'archiveSha256': sha256})
        (self.store_root / 'catalog.json').write_bytes(json_bytes({'schemaVersion': 1, 'models': models}))
        return models

    def convert(self, limit=None, catalog_key=None):
        return convert_actor_material_programs(self.project_root, self.project_root / 'client', self.converter, self.store_root,
                                               lambda: self.preflights.append(True), limit, catalog_key)

    def catalog(self):
        return read_store_catalog(self.store_root)[0]

    def listing_of(self, record):
        payload = (self.store_root / record['manifest'].removeprefix('/l2/')).read_bytes()
        self.assertEqual((hashlib.sha256(payload).hexdigest(), len(payload)), (record['manifestSha256'], record['manifestBytes']))
        return json.loads(payload)

    def test_two_models_naming_one_object_share_one_unit_and_an_unbound_slot_names_none(self):
        models = self.stage_models([
            ('npc-model:' + '1' * 64, {'materialSlots': [graph_slot(TEXTURED_MATERIAL), {'binding': 'unbound-source-slot'}]}),
            ('interlude:item:7:body-part:0:weapon', {'materialSlots': [graph_slot(TEXTURED_MATERIAL.upper())]}),
            ('character-model:0', {'parts': [{'materialSlots': [graph_slot(UNPORTED_MATERIAL)]},
                                             {'materialSlots': [graph_slot(TEXTURED_MATERIAL)]}]})])
        self.assertEqual(actor_material_object_inventory(self.store_root, models), [TEXTURED_MATERIAL, UNPORTED_MATERIAL])
        outcomes, summary = self.convert()
        self.assertEqual([(outcome['key'], outcome['status']) for outcome in outcomes],
                         [(f'material-program:{TEXTURED_MATERIAL}', 'pass'), (f'material-program:{UNPORTED_MATERIAL}', 'gap')])
        self.assertEqual((summary['inventory'], summary['pendingBefore'], summary['sealedUnits'], summary['statusCounts']),
                         (2, 2, 2, {'gap': 1, 'pass': 1}))
        self.assertEqual(self.converted_textures, [TEXTURED_MATERIAL_TEXTURE, UNPORTED_MATERIAL_TEXTURE])
        self.assertEqual(len(self.preflights), 2)

    def test_a_ported_program_publishes_a_pinned_listing_record_whose_files_the_union_walk_follows(self):
        self.stage_models([('npc-model:' + '1' * 64, {'materialSlots': [graph_slot(TEXTURED_MATERIAL)]})])
        self.convert()
        record = self.catalog()['materialPrograms'][0]
        self.assertEqual(validate_catalog_record('materialPrograms', record)['id'], f'material-program:{TEXTURED_MATERIAL}')
        listing = self.listing_of(record)
        self.assertEqual((listing['kind'], listing['schemaVersion'], listing['sourceObject'], listing['rootPorted'], listing['gapReasons']),
                         ('native-actor-material-program', 1, TEXTURED_MATERIAL, True, []))
        self.assertIn(listing['program']['directory'].removeprefix('native-materials/') + '/program.json', listing['files'])
        references = pinned_file_references(listing, 'synthetic listing', 'native-materials')
        self.assertEqual(sorted(reference.relative for reference in references), sorted(f'native-materials/{member}' for member in listing['files']))
        for reference in references:
            self.assertEqual(hashlib.sha256((self.store_root / reference.relative).read_bytes()).hexdigest(), reference.sha256)

    def test_an_unported_root_and_a_missing_package_seal_their_reasons_and_write_no_key_gap_row(self):
        self.stage_models([('npc-model:' + '1' * 64, {'materialSlots': [graph_slot(UNPORTED_MATERIAL),
                                                                        graph_slot(MISSING_MATERIAL)]})])
        outcomes, _ = self.convert()
        self.assertEqual({outcome['key']: outcome['reason'] for outcome in outcomes},
                         {f'material-program:{MISSING_MATERIAL}': 'decode-failed:FormatError:material package missing or ambiguous',
                          f'material-program:{UNPORTED_MATERIAL}': 'material-class-unported:Engine.GlowModifier'})
        listings = {self.listing_of(record)['sourceObject']: self.listing_of(record) for record in self.catalog()['materialPrograms']}
        self.assertEqual((listings[MISSING_MATERIAL]['program'], listings[MISSING_MATERIAL]['rootPorted']), (None, False))
        self.assertFalse(listings[UNPORTED_MATERIAL]['rootPorted'])
        self.assertTrue(listings[UNPORTED_MATERIAL]['program']['directory'].startswith('native-materials/'))
        ledger = UnitLedger(lane_work_root(self.project_root, 'actors'), MATERIAL_PROGRAMS_STEP, 1)
        self.assertEqual([receipt['gapRows'] for receipt in ledger.sealed_receipts()], [[], []])
        self.assertFalse((self.project_root / 'artifacts' / 'lane-store' / 'actors' / 'gap-rows').exists())

    def test_a_second_run_is_a_ledger_skip_and_a_limit_converts_only_that_many_pending_units(self):
        self.stage_models([('npc-model:' + '1' * 64, {'materialSlots': [graph_slot(TEXTURED_MATERIAL),
                                                                        graph_slot(UNPORTED_MATERIAL)]})])
        first_outcomes, first = self.convert(limit=1)
        self.assertEqual(([outcome['key'] for outcome in first_outcomes], first['sealedUnits']), ([f'material-program:{TEXTURED_MATERIAL}'], 1))
        catalog_after_first = self.catalog()
        _, second = self.convert(limit=5)
        self.assertEqual((second['pendingBefore'], second['convertedUnits'], second['sealedUnits']), (1, 1, 2))
        self.assertEqual(self.catalog()['materialPrograms'][0], catalog_after_first['materialPrograms'][0])
        third_outcomes, third = self.convert()
        self.assertEqual((third_outcomes, third['pendingBefore'], third['store']['filesWritten']), ([], 0, 0))
        self.assertEqual(self.converted_textures, [TEXTURED_MATERIAL_TEXTURE, UNPORTED_MATERIAL_TEXTURE])

    def test_the_single_key_form_converts_only_the_objects_of_that_key_models(self):
        self.stage_models([('interlude:item:7:body-part:0:weapon', {'materialSlots': [graph_slot(TEXTURED_MATERIAL)]}),
                           ('character-model:3', {'parts': [{'materialSlots': [graph_slot(UNPORTED_MATERIAL)]}]})])
        outcomes, summary = self.convert(catalog_key='item:7')
        self.assertEqual(([outcome['key'] for outcome in outcomes], summary['inventory']), ([f'material-program:{TEXTURED_MATERIAL}'], 1))
        self.assertEqual([record['id'] for record in model_records_of_catalog_key(self.store_root, self.catalog(), 'character:3')],
                         ['character-model:3'])
        with self.assertRaisesRegex(ActorMaterialProgramError, 'item:8 names no model'):
            model_records_of_catalog_key(self.store_root, self.catalog(), 'item:8')

    def test_a_slot_names_the_object_the_converter_resolved_for_its_root(self):
        models = self.stage_models([('npc-model:' + '1' * 64, {'materialSlots': [
            {'sourceReference': 'Pack.Short', 'texture': 'Pack.Group.TextureRoot'},
            {'sourceReference': 'Pack.Other', 'nativeMaterialGraph': [{'object': 'Pack.Group.ShaderRoot'}], 'texture': 'Pack.Group.Leaf'},
            {'sourceReference': 'Pack.Third', 'unsupportedMaterialAdapter': {'class': 'Combiner', 'object': 'pack.group.combinerroot'}},
            {'binding': 'unbound-source-slot'}]})])
        self.assertEqual(model_slot_source_objects(self.store_root, models[0]),
                         ['Pack.Group.TextureRoot', 'Pack.Group.ShaderRoot', 'pack.group.combinerroot', None])
        apostrophe = "LineageWeaponsTex.knife_o'_silenus.knife_o'_silenus_t00_wp"
        self.stage_models([('interlude:item:241:body-part:7:weapon', {'materialSlots': [{'texture': apostrophe}]})])
        self.assertEqual(actor_material_object_inventory(self.store_root, self.catalog()['models']), [apostrophe])
        self.assertEqual(validate_catalog_record('materialPrograms', {'id': f'material-program:{apostrophe}', 'manifest': f'/l2/native-materials/material-program-{"e" * 64}.json',
                                                                       'manifestSha256': 'e' * 64, 'manifestBytes': 10})['id'], f'material-program:{apostrophe}')
        self.stage_models([('npc-model:' + '1' * 64, {'materialSlots': [{'texture': 'Pack.Group.Same'}]}),
                           ('npc-model:' + '2' * 64, {'materialSlots': [{'texture': 'pack.group.same'}]})])
        self.assertEqual(actor_material_object_inventory(self.store_root, self.catalog()['models']), ['Pack.Group.Same'])

    def test_the_inventory_refuses_a_changed_archive_and_a_slot_reference_that_is_no_object_name(self):
        models = self.stage_models([('npc-model:' + '1' * 64, {'materialSlots': [{'texture': 'not an object'}]})])
        with self.assertRaisesRegex(ActorMaterialProgramError, 'no qualified object name'):
            actor_material_object_inventory(self.store_root, models)
        with self.assertRaisesRegex(ActorMaterialProgramError, 'differs from its SHA-256'):
            actor_material_object_inventory(self.store_root, [{**models[0], 'archiveSha256': 'f' * 64}])

    def test_a_listing_with_an_unported_root_and_no_reason_is_refused(self):
        with self.assertRaisesRegex(ActorMaterialProgramError, 'unported root and no gap reason'):
            material_program_listing(UNPORTED_MATERIAL, MaterialProgramOutcome(None, None, [], []))

    def test_the_catalog_slice_refuses_a_record_that_is_no_pinned_material_program_listing(self):
        valid = {'id': f'material-program:{TEXTURED_MATERIAL}', 'manifest': f'/l2/native-materials/material-program-{"e" * 64}.json',
                 'manifestSha256': 'e' * 64, 'manifestBytes': 10}
        self.assertEqual(merge_catalog_slice({'schemaVersion': 1, 'models': []}, 'materialPrograms', valid, 1)['materialPrograms'], [valid])
        for broken in ({**valid, 'id': 'material-program:NoGroup'}, {**valid, 'manifestSha256': 'd' * 64}, {**valid, 'manifestBytes': 1_000_001},
                       {**valid, 'program': None}):
            with self.assertRaises(CatalogWriteError):
                validate_catalog_record('materialPrograms', broken)

    def test_the_single_key_argument_names_only_actor_model_keys(self):
        self.assertEqual(actor_model_key_argument('npc:20001'), 'npc:20001')
        for refused in ('tile:20_21', 'npc:020001', 'character:10000'):
            with self.assertRaises(Exception):
                actor_model_key_argument(refused)


if __name__ == '__main__':
    unittest.main()
