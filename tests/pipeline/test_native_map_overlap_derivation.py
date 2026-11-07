import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('overlap_derivation', ROOT / 'scripts/derive-native-map-overlap.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OverlapDerivationTests(unittest.TestCase):
    def source(self):
        manifest = {'placements': [{'id': 'original', 'modelId': 'tree', 'materialOverrides': []}],
                    'models': [{'id': 'tree'}], 'derivation': {'changedVScalars': 735, 'primaryUVSha256': 'retained'},
                    'coverage': {'diagnosticMaterialPlacements': 12}, 'gaps': ['native pixels unverified']}
        return {module.MANIFEST_FILE: json.dumps(manifest).encode(),
                'map-section-runtime/receipt.json': b'{"derivation":{"changedVScalars":735}}',
                'map-section/terrain.glb': b'corrected UV and UV2', 'map-section-models/tree/model.glb': b'existing native mesh'}

    def test_additive_derivation_preserves_source_records_and_all_geometry_bytes(self):
        files = self.source()
        before = copy.deepcopy(files)
        report = {'additions': [{'id': 'overlap', 'modelId': 'tree', 'materialOverrides': []}]}
        digest, output = module.derive(files, report)
        self.assertEqual(files, before)
        new = json.loads(output[module.MANIFEST_FILE])
        old = json.loads(before[module.MANIFEST_FILE])
        self.assertEqual(new['placements'], old['placements'] + report['additions'])
        self.assertEqual(new['models'], old['models'])
        self.assertEqual(new['derivation']['changedVScalars'], 735)
        self.assertEqual(new['derivation']['primaryUVSha256'], 'retained')
        self.assertEqual(module.sha(output[module.MANIFEST_FILE]), digest)
        for name in ('map-section/terrain.glb', 'map-section-models/tree/model.glb'):
            self.assertEqual(output[name], before[name])
        self.assertEqual(new['derivation']['placementOverlap']['auditSha256'], module.sha(output['map-section-runtime/overlap-selection.json']))

    def test_colliding_unknown_and_overridden_placements_fail_without_mutation(self):
        invalid = [[], [{'id': 'original', 'modelId': 'tree', 'materialOverrides': []}],
                   [{'id': 'overlap', 'modelId': 'new-model', 'materialOverrides': []}],
                   [{'id': 'overlap', 'modelId': 'tree', 'materialOverrides': ['unsupported']}],
                   [{'id': 'overlap', 'modelId': 'tree', 'materialOverrides': []}] * 2]
        for additions in invalid:
            with self.subTest(additions=additions):
                files = self.source()
                before = copy.deepcopy(files)
                with self.assertRaises(ValueError):
                    module.derive(files, {'additions': additions})
                self.assertEqual(files, before)


if __name__ == '__main__':
    unittest.main()
