import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))

from native_assets_lib.emitter_classes import EMITTER_CLASS_COVERAGE_RELATIVE_PATH, EmitterClassCoverageError, read_simulated_emitter_classes


def project_with_emitter_class_coverage(project_root, document):
    path = Path(project_root) / EMITTER_CLASS_COVERAGE_RELATIVE_PATH
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(document), encoding='utf-8')
    return project_root


class SimulatedEmitterClassesTests(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.project_root = Path(temporary_directory.name)

    def test_the_listed_simulated_classes_are_read(self):
        project_with_emitter_class_coverage(self.project_root, {'schemaVersion': 1, 'listVersion': 2, 'source': 'review',
                                                                'simulated': ['Engine.SpriteEmitter', 'Engine.MeshEmitter']})
        self.assertEqual(read_simulated_emitter_classes(self.project_root), frozenset({'Engine.SpriteEmitter', 'Engine.MeshEmitter'}))

    def test_a_repeated_or_non_engine_class_is_refused(self):
        for simulated in (['Engine.SpriteEmitter', 'Engine.SpriteEmitter'], ['Custom.SpriteEmitter']):
            with self.subTest(simulated=simulated):
                project_root = self.project_root / str(len(simulated)) / simulated[-1]
                project_with_emitter_class_coverage(project_root, {'schemaVersion': 1, 'listVersion': 1, 'source': 'review',
                                                                   'simulated': simulated})
                with self.assertRaisesRegex(EmitterClassCoverageError, 'unique Engine emitter class names'):
                    read_simulated_emitter_classes(project_root)


if __name__ == '__main__':
    unittest.main()
