import hashlib
from pathlib import Path, PurePosixPath
import struct
import tempfile

from actors.actor_census import ActorPackageCensus, lock_skeletal_package_paths
from native_assets_lib.skill_audio_bundle import REFERENCE_FIELDS
from reference_client_guard import require_reference_client
from reference_client_lock_fixture import lock_client_as_checked_conversion_root
from test_texture_package_census import GARBAGE_HEADER, synthetic_wrapped_package_header

UNREAL_PACKAGE_SIGNATURE = 0x9E2A83C1
SYNTHETIC_MESH = 'SyntheticMonsters.synthetic_m00'
SYNTHETIC_FIRST_TEXTURE = 'SyntheticMonstersTex.synthetic_t00'
SYNTHETIC_SECOND_TEXTURE = 'SyntheticMonstersTex.synthetic_t01'
SYNTHETIC_ARMOR_COLUMNS = ['m_SyntheticRace', 'f_SyntheticRace', 'Synthetic_NPC']


def unwrapped_package_header(package_version, licensee):
    return struct.pack('<IHHIIIIIII', UNREAL_PACKAGE_SIGNATURE, package_version, licensee, 0, 1, 0, 1, 0, 1, 0).ljust(128, b'\0')


def wrapped_package(relative_path, package_version, licensee):
    return synthetic_wrapped_package_header(PurePosixPath(relative_path).name, package_version, licensee)


SYNTHETIC_PACKAGES = {
    'animations/SyntheticMonsters.ukx': wrapped_package('animations/SyntheticMonsters.ukx', 123, 28),
    'animations/SyntheticHeroes.ukx': wrapped_package('animations/SyntheticHeroes.ukx', 123, 30),
    'animations/SyntheticElders.ukx': wrapped_package('animations/SyntheticElders.ukx', 123, 23),
    'animations/SyntheticSkill.usk': unwrapped_package_header(123, 28),
    'animations/SyntheticBroken.ukx': GARBAGE_HEADER,
    'animations/SyntheticTwin.ukx': wrapped_package('animations/SyntheticTwin.ukx', 123, 28),
    'staticmeshes/syntheticTWIN.ukx': wrapped_package('staticmeshes/syntheticTWIN.ukx', 123, 28),
    'systextures/SyntheticMonstersTex.utx': wrapped_package('systextures/SyntheticMonstersTex.utx', 123, 28),
    'systextures/SyntheticEldersTex.utx': wrapped_package('systextures/SyntheticEldersTex.utx', 123, 31),
    'systextures/SyntheticUnusedTex.utx': wrapped_package('systextures/SyntheticUnusedTex.utx', 123, 28),
    'sounds/SyntheticSound.uax': b'synthetic sound package bytes that the census never reads',
}


class SyntheticActorClient:
    def __init__(self, test_case, packages=SYNTHETIC_PACKAGES):
        temporary_directory = tempfile.TemporaryDirectory()
        test_case.addCleanup(temporary_directory.cleanup)
        base = Path(temporary_directory.name).resolve()
        self.client_root = base / 'conversion'
        for relative_path, payload in packages.items():
            path = self.client_root / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
        lock_client_as_checked_conversion_root(test_case, self.client_root, base / 'reference', list(packages))
        self.access = require_reference_client(self.client_root)

    def package_census(self):
        return ActorPackageCensus(self.access, lock_skeletal_package_paths(self.access.lock))


def synthetic_decoded_table(source, collection, rows):
    return {'source': source, 'sourceSha256': hashlib.sha256(source.encode('ascii')).hexdigest(),
            'data': {'data': len(rows), collection: rows}}


def synthetic_npcgrp(npc_selections):
    return synthetic_decoded_table('system/npcgrp.dat', 'npc', [
        {'npc_id': npc_id, 'mesh_name': mesh, 'texture_name': [{'param_texture_name': texture} for texture in textures]}
        for npc_id, (mesh, textures) in npc_selections.items()])


def synthetic_character(body_meshes, body_textures, hair_mesh='', hair_texture=''):
    return {'face_icon': 'SyntheticIcons.face', 'hair_mesh': [{'param_hair_mesh': hair_mesh}] if hair_mesh else [],
            'hair_texture': [{'param_hair_texture': hair_texture}] if hair_texture else [],
            'body_mesh': {f'body_mesh{slot}': mesh for slot, mesh in enumerate(body_meshes, start=1)},
            'body_texture': {f'body_texture{slot}': texture for slot, texture in enumerate(body_textures, start=1)},
            'attack_effect': 'SyntheticEffects.attack', 'walkanimframe': 12}


def synthetic_chargrp(characters):
    table = synthetic_decoded_table('system/chargrp.dat', 'Char', characters)
    del table['data']['data']
    return table


def synthetic_weapongrp(weapons):
    return synthetic_decoded_table('system/weapongrp.dat', 'item', [
        {'object_id': object_id, 'drop_mesh': {'drop_mesh1': 'SyntheticDrops.drop_m00'},
         'wp_mesh': {'wp_mesh': len(meshes), 'mesh_0_': [{'mesh0': mesh} for mesh in meshes]},
         'texture': [{'texture0': texture} for texture in textures]}
        for object_id, (meshes, textures) in weapons.items()])


def synthetic_mesh_texture_compound(meshes, textures):
    return {'var_0_': {'mtx_size_1_': len(meshes), 'for_mtx_size_1_': [{'mtx_mesh_': mesh} for mesh in meshes],
                       'mtx_size_2_': len(textures), 'for_mtx_size_2_': [{'mtx_text_': texture} for texture in textures]}}


def synthetic_armorgrp(armors):
    return synthetic_decoded_table('system/armorgrp.dat', 'item', [
        {'object_id': object_id, **{column: synthetic_mesh_texture_compound(*columns.get(column, ([''], ['']))) for column in SYNTHETIC_ARMOR_COLUMNS}}
        for object_id, columns in armors.items()])


def synthetic_skillgrp(skills):
    return synthetic_decoded_table('system/skillgrp.dat', 'skill', [
        {'skill_id': skill_id, 'skill_level': skill_level, 'description': description, 'icon': 'SyntheticIcons.skill'}
        for skill_id, skill_level, description in skills])


def synthetic_skill_sound_row(skill_id, skill_level, references_by_field):
    return {'skill_id': skill_id, 'skill_level': skill_level, **{field: references_by_field.get(field, '') for field in REFERENCE_FIELDS},
            'cast_volume': 250.0, 'cast_rad': 50.0}


def synthetic_skillsoundgrp(sound_rows):
    return synthetic_decoded_table('system/skillsoundgrp.dat', 'skillsound', [
        synthetic_skill_sound_row(skill_id, skill_level, references_by_field) for skill_id, skill_level, references_by_field in sound_rows])


def synthetic_actor_tables(npc_selections):
    return {
        'npcgrp': synthetic_npcgrp(npc_selections),
        'chargrp': synthetic_chargrp([synthetic_character([SYNTHETIC_MESH], [SYNTHETIC_FIRST_TEXTURE])]),
        'weapongrp': synthetic_weapongrp({11: ([SYNTHETIC_MESH], [SYNTHETIC_FIRST_TEXTURE])}),
        'armorgrp': synthetic_armorgrp({21: {'m_SyntheticRace': ([SYNTHETIC_MESH], [SYNTHETIC_FIRST_TEXTURE])}}),
        'skillgrp': synthetic_skillgrp([(3, 1, ''), (4, 1, 'SyntheticSkill.synthetic_root')]),
        'skillsoundgrp': synthetic_skillsoundgrp([(4, 1, {'spelleffect_sound_1': 'SyntheticSound.cast_1'})]),
    }
