import hashlib
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
import stage_native_runtime as staging
from native_assets import archive_bytes
from native_assets_lib.gltf import json_bytes
from native_catalog.cli import json_bytes as profile_json_bytes


def sha(payload):
    return hashlib.sha256(payload).hexdigest()


class RuntimeStagingFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'project'
        self.migration = self.root / 'artifacts/migration'
        self.destination = self.root / 'public/l2'
        self.patch = patch.object(staging, 'ROOT', self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.section = self.migration / 'sections/map-20-20-section'
        self.runtime = self.section / 'map-section-runtime'
        self.geometry = self.section / 'map-section'
        image = b'original editable PNG bytes'
        provenance = json_bytes({'metadata': {'materialSlots': [{'texture': 'Textures.Body.diffuse', 'textureSha256': sha(image)}]}})
        payloads = {'model.glb': b'opaque validated model GLB fixture', 'provenance.json': provenance}
        self.asset = {'schemaVersion': 1, 'id': 'interlude:Fixture.mesh', 'name': 'Fixture', 'kind': 'model',
            'source': {'object': 'Fixture.mesh', 'package': 'Fixture', 'sha256': 'a' * 64},
            'model': {'file': 'model.glb'}, 'limitations': ['Synthetic staging fixture.'],
            'files': [{'path': name, 'bytes': len(data), 'sha256': sha(data)} for name, data in payloads.items()]}
        self.archive = archive_bytes(self.asset, payloads)
        self.archive_hash = sha(self.archive)
        self.model_folder = self.section / 'map-section-models' / self.archive_hash
        for name, data in {'asset.l2asset': self.archive, 'asset.json': json_bytes(self.asset), **payloads}.items():
            self.write(self.model_folder / name, data)
        self.image = self.model_folder / 'evidence/export/Textures/Body/diffuse.png'
        self.write(self.image, image)
        self.write(self.model_folder / 'evidence/export/unpinned.log', b'not an approved runtime resource')
        outputs = {'terrain.glb': b'opaque validated terrain GLB fixture', 'terrain.bin': b'original terrain buffer',
            'terrain.gltf': json_bytes({'buffers': [{'uri': 'terrain.bin'}]}), 'manifest.json': json_bytes({'kind': 'native-terrain-section'}),
            'native-defaults/Engine.Actor.uc': b'preserved native defaults'}
        for name, data in outputs.items():
            self.write(self.geometry / name, data)
        self.geometry_receipt = {'kind': 'native-terrain-section', 'outputs': {name: sha(data) for name, data in outputs.items()}}
        self.write_json(self.geometry / 'receipt.json', self.geometry_receipt)
        self.manifest = {'schemaVersion': 1, 'kind': 'native-map-section-runtime', 'errors': [],
            'support': 'section-products-ready-for-runtime-validation', 'resourceRoots': {'terrain': '../map-section', 'models': '../map-section-models'},
            'terrain': {'file': 'terrain.glb', 'sha256': sha(outputs['terrain.glb']), 'bytes': len(outputs['terrain.glb'])},
            'models': [{'id': self.asset['id'], 'archive': {'file': self.archive_hash + '/asset.l2asset', 'sha256': self.archive_hash, 'bytes': len(self.archive)},
                'model': {'file': self.archive_hash + '/model.glb', 'sha256': sha(payloads['model.glb']), 'bytes': len(payloads['model.glb'])}}],
            'placements': [{'id': 'native-placement', 'modelId': self.asset['id'], 'matrix': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 213.4, -31.0, 791.9, 1]}],
        }
        self.runtime_receipt = {'schemaVersion': 1, 'kind': 'native-map-section-runtime',
            'modelArchives': {self.archive_hash + '/asset.l2asset': self.archive_hash}}
        self.refresh_receipts()
        character_path = 'models/' + self.archive_hash + '/asset.l2asset'
        self.write(self.migration / character_path, self.archive)
        self.coverage = {'sourceHost': 'IMPORTA-PC', 'sourceManifestSha256': 'b' * 64, 'acceptanceSha256': 'c' * 64, 'jobs': [
            {'id': 'human-male-fighter:0', 'support': 'converted', 'path': character_path, 'sha256': self.archive_hash},
            {'id': 'map-20-20-section', 'adapter': 'map-section', 'support': self.manifest['support'],
             'path': 'sections/map-20-20-section/map-section-runtime/manifest.json',
             'geometryPath': 'sections/map-20-20-section/map-section/manifest.json'},
        ]}
        self.write_json(self.migration / 'coverage.json', self.coverage)
        self.write_json(self.migration / 'validation.json', {'passed': True, 'errors': []})

    def write(self, path, payload):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)

    def write_json(self, path, value):
        self.write(path, json_bytes(value))

    def refresh_receipts(self):
        self.write_json(self.runtime / 'manifest.json', self.manifest)
        self.runtime_receipt['manifestSha256'] = sha((self.runtime / 'manifest.json').read_bytes())
        self.runtime_receipt['sectionReceiptSha256'] = sha((self.geometry / 'receipt.json').read_bytes())
        self.write_json(self.runtime / 'receipt.json', self.runtime_receipt)

    def stage(self):
        return staging.stage_runtime(self.migration, self.destination)

    def add_npc_profiles(self, actor_class_exports=None, mesh_export=None):
        self.npc_root = self.migration / 'npc-profiles/reference-npcs'
        requested_mesh = 'LineageMonsters.field_stalker_m00'
        profile = {'id': 'npc:21622', 'npcId': 21622, 'name': 'Greater Musveren',
            'mesh': mesh_export or requested_mesh, 'actorClass': 'LineageMonster.field_stalker_20_bi',
            'sourceUnitsPerMetre': 100, 'drawScale': 1.2, 'drawScale3D': [1, 1, 1],
            'collisionRadius': 18, 'collisionHeight': 36,
            'unsupportedFields': [{'field': 'prePivot', 'reason': 'Native constructor value remains unproven.'}]}
        recipe = {'schemaVersion': 1, 'id': 'interlude:npc-profiles:fixture', 'nameTable': 'npcname-e.dat',
            'sourceUnitsPerMetre': 100, 'profiles': [{'npcId': 21622, 'expectedName': profile['name'],
                'expectedMesh': requested_mesh, 'expectedActorClass': profile['actorClass']}]}
        source_files = [{'path': name, 'bytes': 123, 'sha256': str(index) * 64} for index, name in enumerate([
            'system/npcname-e.dat', 'system/npcgrp.dat', 'animations/LineageMonsters.ukx', 'system/Engine.u'])]
        actor_class_exports = actor_class_exports or [profile['actorClass']]
        chain = [actor_class_exports[0], 'Engine.Actor', 'Core.Object']
        class_parents = {**{name: 'Engine.Actor' for name in actor_class_exports}, 'Engine.Actor': 'Core.Object', 'Core.Object': None}
        self.npc_payloads = {}
        for name, parent in class_parents.items():
            definition = {'object': name, 'nativeSuperClass': parent,
                'source': {'object': name, 'package': 'system/Engine.u', 'packageSha256': '3' * 64},
                'effectiveProperties': {'DrawScale': 1.2, 'DrawScale3D': {'X': 1, 'Y': 1, 'Z': 1},
                    'CollisionHeight': 36, 'CollisionRadius': 18}}
            self.npc_payloads['source/classes/' + name + '.json'] = json_bytes(definition)
            self.npc_payloads['source/classes/' + name + '.uc'] = b'preserved native class source'
            self.npc_payloads['source/classes/' + name + '.bin'] = b'preserved native class export'
        selections = {'tables': {'npcname': {'source': 'system/npcname-e.dat', 'sourceSha256': '0' * 64},
            'npcgrp': {'source': 'system/npcgrp.dat', 'sourceSha256': '1' * 64}}, 'selections': [{
            'id': profile['id'], 'classChain': chain,
            'meshSource': {'reference': requested_mesh, 'object': profile['mesh'], 'class': 'SkeletalMesh',
                'resolution': 'exact-qualified-object', 'package': 'animations/LineageMonsters.ukx', 'packageSha256': '2' * 64},
            'nameRow': {'row': {'id': 21622, 'name': profile['name']}},
            'groupRow': {'row': {'npc_id': 21622, 'mesh_name': requested_mesh, 'class_name': profile['actorClass']}}}]}
        self.npc_payloads['source/npc-selections.json'] = json_bytes(selections)
        self.npc_manifest = {'schemaVersion': 1, 'id': recipe['id'], 'kind': 'native-npc-profiles',
            'support': 'source-profile-fields-ready', 'unsupported': [], 'errors': [], 'recipe': recipe,
            'profiles': [profile], 'tools': {'implementation': {'native_actor_profiles.py': 'd' * 64}},
            'sourceFiles': source_files, 'sourceSelections': 'source/npc-selections.json', 'classDefinitions': list(class_parents),
            'coverage': {'requestedProfiles': 1, 'resolvedProfiles': 1}, 'visualAcceptance': 'unverified'}
        self.coverage['jobs'].append({'id': 'reference-npcs', 'adapter': 'npc-profiles',
            'support': 'source-profile-fields-ready', 'path': 'npc-profiles/reference-npcs/manifest.json'})
        self.write_json(self.migration / 'coverage.json', self.coverage)
        self.refresh_npc_receipt()

    def refresh_npc_receipt(self):
        for name, payload in self.npc_payloads.items():
            self.write(self.npc_root / name, payload)
        records = [{'file': name, 'bytes': len(payload), 'sha256': sha(payload)} for name, payload in sorted(self.npc_payloads.items())]
        self.npc_manifest['files'] = records
        self.write(self.npc_root / 'manifest.json', profile_json_bytes(self.npc_manifest))
        receipt = {'schemaVersion': 1, 'manifestSha256': sha((self.npc_root / 'manifest.json').read_bytes()),
            'recipeSha256': sha(profile_json_bytes(self.npc_manifest['recipe'])), 'tools': self.npc_manifest['tools'],
            'sourceFiles': self.npc_manifest['sourceFiles'], 'files': records}
        self.write_json(self.npc_root / 'receipt.json', receipt)

    def directory_link_or_junction_without_symlink_privilege(self, link, target):
        try:
            link.symlink_to(target, target_is_directory=True)
        except OSError:
            if os.name != 'nt':
                raise
            import _winapi
            _winapi.CreateJunction(str(target), str(link))
