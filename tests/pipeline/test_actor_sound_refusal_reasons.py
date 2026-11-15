from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from actors import actor_sound_conversion
from actors.actor_sound_conversion import ActorSoundConversionRun
from actors.npc_requests import CONVERTER_REFUSED_REASON_PREFIX
from native_store.store_paths import lane_store_root

SYNTHETIC_SOUND_REQUEST = {'kind': 'audio', 'package': 'Sounds/SyntheticSound.uax', 'object': 'SyntheticSound.Hit'}


class HostPathRefusingConverter:
    def __init__(self, client_root, output):
        self.client_root, self.output = client_root, output

    def convert(self, request):
        raise ValueError(f'Source {request["package"]} missing under {self.client_root.as_posix()}; '
                         f'Existing content-addressed output is corrupt: {(self.output / "ab" / "asset.l2asset").as_posix()}')


class HostPathSoundRun(ActorSoundConversionRun):
    def __init__(self, project_root, client_root, converter_output):
        self.project_root = Path(project_root)
        self.client_access = SimpleNamespace(root=Path(client_root))
        self.converter = HostPathRefusingConverter(Path(client_root), Path(converter_output))
        self.store_root = lane_store_root(project_root, 'actors')
        self.lane_folder = self.store_root.parent


class ActorSoundRefusalReasonTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        temporary_root = Path(temporary_directory.name).resolve()
        self.project_root, self.client_root = temporary_root / 'project', temporary_root / 'client'
        (self.project_root / 'artifacts').mkdir(parents=True)
        self.run = HostPathSoundRun(self.project_root, self.client_root, temporary_root / 'converter-output')
        self.step_directory = self.run.lane_folder / 'work' / 'synthetic-bundle' / 'actor-sound'
        self.step_directory.mkdir(parents=True)

    def test_a_refused_sound_conversion_seals_a_reason_without_host_paths(self):
        with mock.patch.object(actor_sound_conversion, 'sound_payload', return_value=(b'native wav', {})):
            outcome = self.run.converted_sound_outcome({'package': None}, {}, SYNTHETIC_SOUND_REQUEST, self.step_directory)
        self.assertEqual(outcome, {'status': 'refused', 'reason': CONVERTER_REFUSED_REASON_PREFIX
                                   + 'Source Sounds/SyntheticSound.uax missing under <source>; '
                                   + 'Existing content-addressed output is corrupt: <output>/ab/asset.l2asset'})

    def test_a_refused_bundle_build_keeps_no_lane_or_client_path_in_its_reason(self):
        recipe_path = self.step_directory / 'recipe.json'
        refusal = ValueError(f'recipe {recipe_path.as_posix()} pins a table under {self.client_root.as_posix()} '
                             f'that differs from {self.run.store_root.as_posix()}')
        inventory = {'schemaVersion': 1, 'kind': 'native-staged-sound-inventory', 'sounds': []}
        with mock.patch.object(actor_sound_conversion, 'build_actor_sound_recipe', return_value={'synthetic': 'recipe'}), \
                mock.patch.object(actor_sound_conversion.combat_audio_bundle, 'prepare', side_effect=refusal):
            manifest, _, reason = self.run.built_bundle('npc:20001', [], {}, inventory, [], self.step_directory)
        self.assertIsNone(manifest)
        self.assertEqual(reason, CONVERTER_REFUSED_REASON_PREFIX + 'recipe <output>/work/synthetic-bundle/actor-sound/recipe.json pins a table '
                                                                   'under <source> that differs from <output>/l2')


if __name__ == '__main__':
    unittest.main()
