from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from synthetic_class_scripts import scratch_work_root

REFERENCE_CLIENT = Path('E:/Lineage2-client')
SOUND_ARRAY_FIELDS = ('DamageSounds', 'BrokenSounds')


@unittest.skipUnless(REFERENCE_CLIENT.is_dir(), 'the conversion client E:/Lineage2-client is absent')
class ReferenceMoverSoundArrayTests(unittest.TestCase):
    def test_20_21_mover0_sound_arrays_decode_to_the_rea_sound_objects(self):
        from native_assets_lib.class_defaults import ReferenceClientClassScripts
        from world.declared_property_types import declared_property_types
        from world.map_actor_properties import actor_properties
        from world.map_sources import MapSources
        from world.static_placement import ClassDefaults
        from world.struct_property_tag_rules import read_struct_property_tag_rules
        from world.struct_property_values import decode_property_tags
        client = REFERENCE_CLIENT.resolve()
        package = MapSources(client).get('maps/20_21.unr')
        mover = next(item for item in package.exports if item['object'] == '20_21.Mover0')
        tags, _, _, _ = actor_properties(package, mover)
        class_defaults = ClassDefaults(scratch_work_root(self, 'mover-sound-arrays-'), ReferenceClientClassScripts(client))
        values = decode_property_tags(package, [tag for tag in tags if tag['name'] in SOUND_ARRAY_FIELDS], mover['classObject'],
                                      declared_property_types(class_defaults), read_struct_property_tag_rules())
        self.assertEqual({field: [element['object'] for element in values[field]] for field in SOUND_ARRAY_FIELDS}, {
            'DamageSounds': ['MonSound.Public_Hit_Stone.Hit_Stone_1', 'MonSound.Public_Hit_Stone.Hit_Stone_2', 'MonSound.Public_Hit_Stone.Hit_Stone_3'],
            'BrokenSounds': ['ItemSound2.Castle.castle_wall_falldown_1', 'ItemSound2.Castle.castle_wall_falldown_2',
                             'ItemSound2.Castle.castle_wall_falldown_4', 'ItemSound2.Castle.castle_wall_falldown_3']})


if __name__ == '__main__':
    unittest.main()
