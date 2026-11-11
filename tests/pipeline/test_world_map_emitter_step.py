import hashlib
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(Path(__file__).parent))
from native_catalog.ue2 import FormatError, Package
from native_store.gap_rows import validate_gap_row
from native_store.tile_manifest_validation import load_tile_manifest_vocabulary
from support.actor_class_defaults import ACTOR_DEFAULTS, SyntheticActorClassDefaults
from support.bsp_room_fixture import ROOM_ZONES, room_model
from ue2_package_fixture import compact, package_bytes, tag
from world.bsp_visibility_step import load_bsp_visibility_rules, tile_visibility_payload
from world.map_emitter_records import ACTOR_RULE_FIELDS, EMITTER_RULE_FIELDS
from world.map_emitter_step import MAP_EMITTER_STEP_ALGORITHM_VERSION, MAP_EMITTER_STEP_NAME, read_tile_map_emitters, tile_map_emitter_row
from world.tile_manifest_step import tile_resources
from world.visibility_members import MAP_EMITTER_MEMBER_KIND, map_emitter_members

TILE_ID = '00_00'
SOURCE_IDENTITY = {'path': f'maps/{TILE_ID}.unr', 'sha256': hashlib.sha256(b'synthetic emitter tile').hexdigest()}
EVIDENCE = f'work/tile__{TILE_ID}/emitters/receipt.json'
INTEGER_PROPERTY_TYPE = 2
BOOL_PROPERTY_TYPE = 3
ARRAY_PROPERTY_TYPE = 9
BOOL_TRUE_BIT = 128
EMITTER_IMPORTS = [('Core', 'Package', 0, 'Engine'), ('Core', 'Class', -1, 'Emitter'), ('Core', 'Class', -1, 'SpriteEmitter'),
                   ('Core', 'Class', -1, 'SparkEmitter')]
EMITTER_CLASS_IMPORT, SPRITE_EMITTER_CLASS_IMPORT, SPARK_EMITTER_CLASS_IMPORT = -2, -3, -4
PROPERTY_NAMES = ['Emitters', 'AutoDestroy', 'MaxParticles']
EMITTER_CLASS = 'Engine.Emitter'
EMITTER_ACTOR_DEFAULTS = {**ACTOR_DEFAULTS, **{field: (None, 'ue-zero', EMITTER_CLASS) for field in ACTOR_RULE_FIELDS},
                          'SpeedRate': (1.0, 'class-default', EMITTER_CLASS)}
PARTICLE_EMITTER_DEFAULTS = {field: (None, 'ue-zero', 'Engine.ParticleEmitter') for field in EMITTER_RULE_FIELDS}
_, RULES = load_bsp_visibility_rules()
CLASS_DEFAULTS = SyntheticActorClassDefaults({EMITTER_CLASS: EMITTER_ACTOR_DEFAULTS, 'Engine.SpriteEmitter': PARTICLE_EMITTER_DEFAULTS,
                                              'Engine.SparkEmitter': PARTICLE_EMITTER_DEFAULTS})


def emitter_actor_body(emitter_export_index, auto_destroy):
    def body(offset, names):
        emitters = tag(names, 'Emitters', ARRAY_PROPERTY_TYPE, compact(1) + compact(emitter_export_index))
        destroy = compact(names['AutoDestroy']) + bytes([BOOL_PROPERTY_TYPE | BOOL_TRUE_BIT]) if auto_destroy else b''
        return emitters + destroy + compact(names['None'])
    return body


def particle_emitter_body(offset, names):
    return tag(names, 'MaxParticles', INTEGER_PROPERTY_TYPE, struct.pack('<i', 4)) + compact(names['None'])


def emitter_package(with_emitters=True, second_emitter_export_index=2):
    exports = [{'name': 'SpriteEmitter0', 'class': SPRITE_EMITTER_CLASS_IMPORT, 'body': particle_emitter_body},
               {'name': 'SparkEmitter0', 'class': SPARK_EMITTER_CLASS_IMPORT, 'body': particle_emitter_body}]
    if with_emitters:
        exports += [{'name': 'Emitter7', 'class': EMITTER_CLASS_IMPORT, 'body': emitter_actor_body(1, True)},
                    {'name': 'Emitter2', 'class': EMITTER_CLASS_IMPORT, 'body': emitter_actor_body(second_emitter_export_index, False)}]
    return Package(package_bytes(PROPERTY_NAMES, EMITTER_IMPORTS, exports), f'{TILE_ID}.unr')


def raw_emitter_actor(actor_name, location):
    omitted = {'status': 'omitted-class-default-unresolved'}
    transform = {name: omitted for name in ('Rotation', 'DrawScale', 'DrawScale3D', 'PrePivot')}
    return {'id': f'interlude:{TILE_ID}.{actor_name}', 'object': f'{TILE_ID}.{actor_name}', 'classObject': EMITTER_CLASS,
            'sourceTransform': {**transform, 'Location': {'status': 'serialized', 'value': dict(zip('XYZ', location))}}}


RAW_ACTORS = {actor['object']: actor for actor in (raw_emitter_actor('Emitter7', (25.0, 10.0, 25.0)), raw_emitter_actor('Emitter2', (50.0, 10.0, 25.0)))}


def field_record(records, field):
    return next(record for record in records if record['field'] == field)


class MapEmitterExportTests(unittest.TestCase):
    def setUp(self):
        self.placements, self.gap_rows = read_tile_map_emitters(emitter_package(), RAW_ACTORS, CLASS_DEFAULTS, TILE_ID, SOURCE_IDENTITY, EVIDENCE)

    def test_two_emitter_actors_export_two_placements_in_export_index_order(self):
        self.assertEqual([(placement.record['id'], placement.record['exportIndex']) for placement in self.placements],
                         [(f'interlude:{TILE_ID}.Emitter7', 3), (f'interlude:{TILE_ID}.Emitter2', 4)])
        self.assertEqual([placement.origin for placement in self.placements], [(25.0, 10.0, 25.0), (50.0, 10.0, 25.0)])
        self.assertEqual(self.placements[0].record['transform'][3], [25.0, 10.0, 25.0, 1])

    def test_actor_rules_are_declared_with_authored_or_class_default_provenance(self):
        rules = self.placements[0].record['actorRules']
        self.assertEqual([record['field'] for record in rules], list(ACTOR_RULE_FIELDS))
        self.assertEqual(field_record(rules, 'AutoDestroy'), {'field': 'AutoDestroy', 'value': True, 'provenance': 'authored', 'declaringClass': EMITTER_CLASS})
        self.assertEqual(field_record(rules, 'SpeedRate'), {'field': 'SpeedRate', 'value': 1.0, 'provenance': 'class-default', 'declaringClass': EMITTER_CLASS})
        self.assertEqual(field_record(self.placements[1].record['actorRules'], 'AutoDestroy')['provenance'], 'ue-zero')

    def test_emitter_records_come_from_the_bundle_writer_and_an_unported_class_is_a_named_gap(self):
        sprite, = self.placements[0].record['bundle']['emitters']
        self.assertEqual((sprite['class'], sprite['converted'], sprite['properties']), ('Engine.SpriteEmitter', True, {'MaxParticles': 4}))
        self.assertEqual([record['field'] for record in sprite['rules']], list(EMITTER_RULE_FIELDS))
        spark, = self.placements[1].record['bundle']['emitters']
        self.assertFalse(spark['converted'])
        self.assertEqual([(row['reason'], row['sourceIdentity']['object']) for row in self.gap_rows],
                         [('emitter-class-unported:Engine.SparkEmitter', f'{TILE_ID}.SparkEmitter0')])
        for row in self.gap_rows:
            validate_gap_row(row)
        self.assertEqual(tile_map_emitter_row(TILE_ID, SOURCE_IDENTITY, self.gap_rows, EVIDENCE)['status'], 'gap')

    def test_a_map_without_emitter_actors_passes_with_no_resource(self):
        placements, gap_rows = read_tile_map_emitters(emitter_package(with_emitters=False), {}, CLASS_DEFAULTS, TILE_ID, SOURCE_IDENTITY, EVIDENCE)
        self.assertEqual((placements, gap_rows), ([], []))
        self.assertEqual(tile_map_emitter_row(TILE_ID, SOURCE_IDENTITY, gap_rows, EVIDENCE)['status'], 'pass')
        self.assertEqual(tile_resources(None, None, None, {'manifest': None, 'gapRows': []}), [])

    def test_an_emitter_actor_missing_from_the_raw_actors_is_a_named_gap_and_the_other_emitters_still_export(self):
        raw_actors = {name: actor for name, actor in RAW_ACTORS.items() if name != f'{TILE_ID}.Emitter2'}
        placements, gap_rows = read_tile_map_emitters(emitter_package(), raw_actors, CLASS_DEFAULTS, TILE_ID, SOURCE_IDENTITY, EVIDENCE)
        self.assertEqual([placement.record['id'] for placement in placements], [f'interlude:{TILE_ID}.Emitter7'])
        self.assertEqual([(row['reason'], row['sourceIdentity']['object']) for row in gap_rows],
                         [('decode-failed:emitter-actor-not-extracted', f'{TILE_ID}.Emitter2')])
        for row in gap_rows:
            validate_gap_row(row)

    def test_an_emitter_reference_past_the_export_table_is_refused_as_a_format_error(self):
        package = emitter_package(second_emitter_export_index=99)
        with self.assertRaisesRegex(FormatError, 'emitter export 99 outside the export table of 4 exports'):
            read_tile_map_emitters(package, RAW_ACTORS, CLASS_DEFAULTS, TILE_ID, SOURCE_IDENTITY, EVIDENCE)

    def test_the_kind_is_in_the_vocabulary_and_the_tile_resource_pins_the_manifest(self):
        self.assertIn('map-emitters', load_tile_manifest_vocabulary().resource_kinds)
        sha256 = '5' * 64
        product = {'manifest': {'resource': f'/l2/map-emitters/{sha256}/tile-emitters.json', 'sha256': sha256, 'bytes': 900}}
        self.assertEqual(tile_resources(None, None, None, product),
                         [{'kind': 'map-emitters', 'manifest': product['manifest']['resource'], 'manifestSha256': sha256, 'manifestBytes': 900}])

    def test_the_step_name_and_version_are_pinned(self):
        self.assertEqual((MAP_EMITTER_STEP_NAME, MAP_EMITTER_STEP_ALGORITHM_VERSION), ('emitters', 1))


class MapEmitterMembershipTests(unittest.TestCase):
    def test_the_visibility_resource_lists_each_emitter_placement_with_its_leaf_and_zone_membership(self):
        product = {'placements': [{'id': f'interlude:{TILE_ID}.Emitter7', 'exportIndex': 3, 'origin': [25.0, 10.0, 25.0]},
                                  {'id': f'interlude:{TILE_ID}.Emitter2', 'exportIndex': 4, 'origin': [50.0, 10.0, 25.0]}]}
        members = map_emitter_members(room_model(), product, frozenset({2}))
        self.assertEqual([(member.kind, member.leaves, member.zone_set) for member in members],
                         [(MAP_EMITTER_MEMBER_KIND, (0,), 1 << 1), (MAP_EMITTER_MEMBER_KIND, (), 0)])
        node_ranges = [{'chunk': 0, 'node': 0, 'primitive': 0, 'firstIndex': 0, 'indexCount': 6}]
        arrays, _, counts = tile_visibility_payload(room_model(), ROOM_ZONES, RULES, node_ranges, members)
        by_name = {array.name: array for array in arrays}
        self.assertEqual((counts['members'], by_name['MEMB.kind'].values, by_name['MEMB.leafStart'].values, by_name['MEMB.leaves'].values),
                         (2, (1, 1), (0, 1, 1), (0,)))


if __name__ == '__main__':
    unittest.main()
