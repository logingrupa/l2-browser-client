import json
import random
from pathlib import Path
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_assets_lib.gltf import json_bytes
from native_assets_lib import stepsound_deco_grass as subject
from native_assets_lib.sha256_identity import sha256_hex_digest
import stage_native_stepsound_deco_grass as stager

REAL_BUNDLE = ROOT / 'artifacts/native-parity/research/dev-sheet-audio-20261107/footstep-deco-grass/bundle'


def snapshot(root):
    return {p.relative_to(root).as_posix(): (p.read_bytes(), p.stat().st_mtime_ns) for p in root.rglob('*') if p.is_file()}


def block(c0, c1, indices):
    bits = 0
    for pixel, index in enumerate(indices):
        bits |= index << (2 * pixel)
    return struct.pack('<HHI', c0, c1, bits)


class DecoGrassMathTests(unittest.TestCase):
    def test_dxt1_green_decodes_both_block_modes_rows_top_first(self):
        rgb565_green_only = lambda g: g << 5
        four_colour_mode_block = block(rgb565_green_only(63), rgb565_green_only(0), [0, 1, 2, 3] * 4)
        transparent_black_mode_block = block(rgb565_green_only(0), rgb565_green_only(63), [0, 1, 2, 3] + [3] * 12)
        values = subject.dxt1_green(four_colour_mode_block + transparent_black_mode_block, 8, 4)
        self.assertEqual(list(values[0:4]), [255, 0, 170, 85])
        self.assertEqual(list(values[4:8]), [0, 255, 127, 0])
        self.assertEqual(list(values[12:16]), [0, 0, 0, 0])
        with self.assertRaisesRegex(ValueError, 'DXT1 level size'):
            subject.dxt1_green(four_colour_mode_block, 8, 4)

    def test_quad_means_use_the_vertex_ratio_footprint(self):
        big = bytearray(8 * 8); big[0] = big[1] = 255; big[5 * 8 + 5] = 255; big[7 * 8 + 7] = 255
        means = subject.quad_means(bytes(big), 8, 8, 4, 4)
        self.assertEqual(len(means), 9)
        self.assertEqual(means[0], .5); self.assertEqual(means[8], .25); self.assertEqual(sum(means), .75)

    def test_expected_capped_matches_a_sampled_min_of_uniform_multiplier(self):
        self.assertEqual(subject.expected_capped(0, 0, 50, 20), 0)
        self.assertEqual(subject.expected_capped(.2, 0, 50, 20), 5)
        self.assertEqual(subject.expected_capped(1, 30, 50, 20), 20)
        self.assertAlmostEqual(subject.expected_capped(1, 0, 50, 20), 16)
        rng = random.Random(4)
        for alpha, low, high, cap in [(.7, 5, 30, 8), (1, 0, 50, 20), (.35, 5, 25, 8)]:
            sampled = sum(min(cap, alpha * rng.uniform(low, high)) for _ in range(40000)) / 40000
            self.assertAlmostEqual(subject.expected_capped(alpha, low, high, cap), sampled, delta=.05)
        with self.assertRaises(ValueError):
            subject.expected_capped(1.5, 0, 1, 1)

    def test_grid_sums_visible_layers_and_encodes_scaled_uint16(self):
        layers = [{'showOnTerrain': 1, 'showOnInvisibleTerrain': 0, 'densityMultiplier': {'min': 0, 'max': 4}, 'maxPerQuad': 10, 'alpha': [1, .5]},
                  {'showOnTerrain': 1, 'showOnInvisibleTerrain': 1, 'densityMultiplier': {'min': 1, 'max': 1}, 'maxPerQuad': 10, 'alpha': [1, 1]},
                  {'showOnTerrain': 0, 'showOnInvisibleTerrain': 1, 'densityMultiplier': {'min': 9, 'max': 9}, 'maxPerQuad': 10, 'alpha': [1, 1]}]
        grid = subject.build_grid(layers, 2, 1, [True, False])
        self.assertEqual(grid, [3.0, 1.0])
        self.assertEqual(struct.unpack('<2H', subject.encode_grid(grid)), (768, 256))
        with self.assertRaisesRegex(ValueError, 'exceeds'):
            subject.encode_grid([300.0])

    def test_orientation_correlation_and_row_flip(self):
        self.assertEqual(subject.flip_rows([1, 2, 3, 4, 5, 6], 2), [5, 6, 3, 4, 1, 2])
        self.assertAlmostEqual(subject.correlation([1, 2, 3], [2, 4, 6]), 1)
        self.assertEqual(subject.correlation([1, 1, 1], [1, 2, 3]), 0)


class FakeInputs:
    def __init__(self, root):
        self.root, self.records, self.checks = root, {}, 0

    def unchanged(self):
        self.checks += 1


class DecoGrassRunTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='deco-grass-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.output = self.root / 'artifacts/deco/bundle'
        self.grid = subject.encode_grid([0.0, 4.0, 1.5, 0.0])
        self.manifest = {'schemaVersion': 1, 'kind': subject.KIND, 'coverage': {'quadsX': 2, 'quadsY': 2},
                         'terrain': {'object': '20_20.TerrainInfo0', 'quads': [2, 2], 'quadSize': [128.0, 128.0], 'origin': [0.0, 0.0],
                                     'sectors': [[0, 0, 2, 2]]},
                         'grid': {'file': 'grid/' + sha256_hex_digest(self.grid) + '.bin', 'bytes': len(self.grid), 'sha256': sha256_hex_digest(self.grid),
                                  'scale': 256, 'maxPerQuad': 4.0, 'totalExpected': 5.5},
                         'rule': {'id': 'r', 'label': subject.RULE_LABEL, 'status': 'approximation', 'countRadius': 64.0, 'grassMinimumCount': 2},
                         'orientationCheck': {'correlations': {}}}

    def prepare(self, root, recipe):
        payloads = {self.manifest['grid']['file']: self.grid, 'manifest.json': json_bytes(self.manifest)}
        return self.manifest, payloads, FakeInputs(self.root)

    def run_bundle(self, **kwargs):
        return subject.run(self.root, self.root / 'recipe.json', self.output, prepare_bundle=self.prepare, **kwargs)

    def test_plan_produce_repeat_and_verify_preserve_bytes(self):
        self.assertEqual(self.run_bundle(plan=True)['filesWritten'], 0)
        self.assertFalse(self.output.exists())
        with self.assertRaisesRegex(ValueError, 'Verify-only requires'):
            self.run_bundle(verify_only=True)
        produced = self.run_bundle()
        self.assertEqual((produced['status'], produced['filesWritten']), ('produced', 2))
        before = snapshot(self.output)
        self.assertEqual(self.run_bundle()['filesWritten'], 0)
        self.assertEqual(self.run_bundle(verify_only=True)['status'], 'verified')
        self.assertEqual(snapshot(self.output), before)

    def test_existing_differing_output_is_preserved_and_output_must_be_an_artifacts_child(self):
        self.run_bundle()
        (self.output / self.manifest['grid']['file']).write_bytes(b'\0\0')
        before = snapshot(self.output)
        with self.assertRaisesRegex(ValueError, 'Existing immutable output differs'):
            self.run_bundle()
        self.assertEqual(snapshot(self.output), before)
        with self.assertRaisesRegex(ValueError, 'named artifacts/scratch'):
            subject.run(self.root, self.root / 'recipe.json', self.root / 'public/out', prepare_bundle=self.prepare)

    def stage_setup(self):
        self.run_bundle()
        public = self.root / 'public/l2'; public.mkdir(parents=True)
        catalog = {'schemaVersion': 1, 'models': [], 'animationAudio': [{'id': 'human-fighter-footsteps', 'manifestSha256': 'a' * 64}]}
        (public / 'catalog.json').write_bytes(json_bytes(catalog))
        return sha256_hex_digest((self.output / 'manifest.json').read_bytes()), sha256_hex_digest((public / 'catalog.json').read_bytes()), catalog

    def test_stager_plan_stage_repeat_and_verify(self):
        manifest_hash, catalog_hash, catalog = self.stage_setup()
        plan = stager.stage(self.output, manifest_hash, catalog_hash, plan=True, root=self.root)
        self.assertEqual((plan['filesWritten'], len(plan['newResources'])), (0, 2))
        self.assertFalse((self.root / 'public/l2/step-sounds').exists())
        staged = stager.stage(self.output, manifest_hash, catalog_hash, root=self.root)
        self.assertEqual(staged['filesWritten'], 3)
        after = json.loads((self.root / 'public/l2/catalog.json').read_bytes())
        self.assertEqual(after['animationAudio'][0], catalog['animationAudio'][0])
        self.assertEqual(after['animationAudio'][1], {'id': 'stepsound-deco-grass-20-20', 'kind': stager.KIND,
            'manifest': f'/l2/step-sounds/{manifest_hash}/manifest.json',
            'manifestBytes': (self.output / 'manifest.json').stat().st_size, 'manifestSha256': manifest_hash})
        self.assertEqual((self.root / f'public/l2/step-sounds/{manifest_hash}/{self.manifest["grid"]["file"]}').read_bytes(), self.grid)
        before = snapshot(self.root / 'public')
        self.assertEqual(stager.stage(self.output, manifest_hash, staged['resultingCatalogSha256'], root=self.root)['filesWritten'], 0)
        self.assertEqual(stager.stage(self.output, manifest_hash, staged['resultingCatalogSha256'], verify_only=True, root=self.root)['filesWritten'], 0)
        self.assertEqual(snapshot(self.root / 'public'), before)

    def test_stager_refuses_changed_catalog_conflicts_and_bad_payloads(self):
        manifest_hash, catalog_hash, catalog = self.stage_setup()
        with self.assertRaisesRegex(ValueError, 'Catalog changed'):
            stager.stage(self.output, manifest_hash, 'b' * 64, root=self.root)
        with self.assertRaisesRegex(ValueError, 'not completely staged'):
            stager.stage(self.output, manifest_hash, catalog_hash, verify_only=True, root=self.root)
        conflicting = json.loads(json_bytes(catalog))
        conflicting['animationAudio'].append({'id': 'older-deco', 'kind': stager.KIND, 'manifestSha256': 'c' * 64})
        (self.root / 'public/l2/catalog.json').write_bytes(json_bytes(conflicting))
        with self.assertRaisesRegex(ValueError, 'Another deco-grass bundle'):
            stager.stage(self.output, manifest_hash, sha256_hex_digest(json_bytes(conflicting)), root=self.root)
        (self.root / 'public/l2/catalog.json').write_bytes(json_bytes(catalog))
        (self.output / self.manifest['grid']['file']).write_bytes(b'\1' * len(self.grid))
        with self.assertRaisesRegex(ValueError, 'grid payload differs'):
            stager.stage(self.output, manifest_hash, catalog_hash, root=self.root)
        self.assertFalse((self.root / 'public/l2/step-sounds').exists())


@unittest.skipUnless((REAL_BUNDLE / 'manifest.json').exists(), 'Real deco-grass bundle not produced in this checkout')
class RealDecoGrassRecipeTests(unittest.TestCase):
    def test_real_recipe_verifies_the_retained_bundle_from_original_packages(self):
        result = subject.run(ROOT, ROOT / 'recipes/native-stepsound-surfaces-deco-grass.json', REAL_BUNDLE, verify_only=True)
        self.assertEqual((result['status'], result['filesWritten']), ('verified', 0))
        self.assertEqual(result['coverage'], {'decoLayers': 4, 'quadsX': 255, 'quadsY': 255, 'sectors': 256,
                                              'visibleQuads': 64997, 'quadsWithExpectedInstances': 13712})
        manifest = json.loads((REAL_BUNDLE / 'manifest.json').read_bytes())
        self.assertEqual([layer['densityMap']['object'] for layer in manifest['decoLayers']],
                         ['L2DecoLayer.Oren.20_20_Deco01', 'L2DecoLayer.Oren.20_20_Deco02', 'L2DecoLayer.Oren.20_20_Deco03', 'L2DecoLayer.Oren.20_20_Deco04'])
        self.assertEqual([layer['maxPerQuad'] for layer in manifest['decoLayers']], [20, 8, 8, 10])
        self.assertEqual(manifest['terrain']['origin'], [0.0, 65536.0])
        self.assertEqual(manifest['rule']['label'], subject.RULE_LABEL)
        check = result['orientationCheck']
        self.assertGreater(check['T_20_20.Height.20_20_G1']['sameRows'], abs(check['T_20_20.Height.20_20_G1']['flippedRows']))
        self.assertLess(check['T_20_20.Height.20_20_R']['sameRows'], 0)

    def test_staged_copy_matches_the_bundle(self):
        catalog = json.loads((ROOT / 'public/l2/catalog.json').read_bytes())
        entries = [row for row in catalog.get('animationAudio', []) if row.get('kind') == stager.KIND]
        if not entries:
            self.skipTest('Deco-grass bundle not staged in this checkout')
        manifest_hash = sha256_hex_digest((REAL_BUNDLE / 'manifest.json').read_bytes())
        result = stager.stage(REAL_BUNDLE, manifest_hash, sha256_hex_digest((ROOT / 'public/l2/catalog.json').read_bytes()), verify_only=True)
        self.assertEqual(result['filesWritten'], 0)


if __name__ == '__main__':
    unittest.main()
