import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('model_append', ROOT/'scripts/derive-native-map-model.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ARCHIVE = ROOT/'artifacts/native-parity/research/map-overlap-expansion-20261106/source-normal-correction/derived/4a800ae694cbf210835e14a3684763de8c0bc3258bdbce316f0bb7bda995ded3/asset.l2asset'


@unittest.skipUnless(ARCHIVE.is_file(), 'Pinned local original model is private')
class OriginalModelAppendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = module.base_files()
        with zipfile.ZipFile(ARCHIVE) as archive:
            cls.model = {name: archive.read(name) for name in archive.namelist()}
        cls.model['asset.l2asset'] = ARCHIVE.read_bytes()
        cls.proof = json.loads(module.checked(ROOT/module.PROOF, module.PROOF_SHA))
        actor = cls.proof['actor']
        cls.placement = {'id': module.ACTOR, 'modelId': module.MODEL, 'sourceMesh': actor['sourceObject'],
                         'sourceLocation': actor['origin'], 'matrix': module.gltf_placement(actor['nativeRowMatrix']), 'materialOverrides': []}

    def test_original_resources_and_relationships_survive_exactly(self):
        digest, result = module.derive(self.base, self.model, self.placement, self.proof)
        old, new = json.loads(self.base[module.MANIFEST]), json.loads(result[module.MANIFEST])
        self.assertEqual(len(new['models']), 62)
        self.assertEqual(len(new['placements']), 157)
        self.assertEqual(old['models'], new['models'][:-1])
        self.assertEqual(old['placements'], new['placements'][:-1])
        for key in ('terrain','bsp','resourceRoots','support','surfaceSpawnCandidate','unsupportedRuntimeMaterials'):
            self.assertEqual(old[key],new[key])
        self.assertEqual({name for name in self.base if self.base[name]!=result[name]}, {module.MANIFEST,module.RECEIPT})
        self.assertEqual(len(result), 952)
        self.assertEqual(digest, module.sha(result[module.MANIFEST]))
        receipt = json.loads(result['map-section-runtime/new-model-overlap.json'])
        self.assertEqual([(r['section'],r['triangle'])for r in receipt['intersections']],[(2,i)for i in(243,244,248,249,264,265,269,270)])

    def test_rejects_placement_without_proven_indexed_overlap(self):
        placement = copy.deepcopy(self.placement);placement['matrix'][12]+=100
        with self.assertRaisesRegex(ValueError,'Indexed overlap differs'):
            module.derive(self.base,self.model,placement,self.proof)

    def test_rejects_uncorrected_normals_in_historical_glb(self):
        original = ROOT/'artifacts/native-parity/research/map-overlap-expansion-20261106/new-tree-conversion/conversion/3333e47c45901dc8ddd9308f635d0d50fbc45bd5e76935e3539477af0f002165/model.glb'
        model=dict(self.model);model['model.glb']=original.read_bytes()
        with self.assertRaisesRegex(ValueError,'Wrong corrected source model'):
            module.derive(self.base,model,self.placement,self.proof)

    def test_rejects_changed_base_and_wrong_actor_without_output_mutation(self):
        base=dict(self.base);value=json.loads(base[module.MANIFEST]);value['placements'][0]['matrix'][12]+=1
        base[module.MANIFEST]=module.json_bytes(value)
        with self.assertRaisesRegex(ValueError,'Base scope differs'):
            module.derive(base,self.model,self.placement,self.proof)
        placement=copy.deepcopy(self.placement);placement['id']='interlude:20_20.StaticMeshActorOther'
        with self.assertRaisesRegex(ValueError,'Wrong new placement'):
            module.derive(self.base,self.model,placement,self.proof)
        self.assertEqual(module.sha(self.base[module.MANIFEST]),module.BASE)

    def test_clean_derivation_is_identical_and_catalog_changes_only_section(self):
        first, products = module.derive(self.base,self.model,self.placement,self.proof)
        self.assertEqual((first,products),module.derive(self.base,self.model,self.placement,self.proof))
        before=(ROOT/'public/l2/catalog.json').read_bytes()
        catalog=json.loads(before);selected=next(s for s in catalog['sections']if s['id']==module.io.SECTION)
        # Current source may already have this append; reconstruct only the selected token for this fixture.
        if selected['manifestSha256']==first:
            before=module.io.catalog_replace(before,first,module.BASE)
        changed=module.io.catalog_replace(before,module.BASE,first)
        self.assertEqual(changed,before.replace(module.BASE.encode(),first.encode()))


if __name__=='__main__':unittest.main()
