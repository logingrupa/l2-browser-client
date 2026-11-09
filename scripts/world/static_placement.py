import json
import math
from pathlib import Path
import re

from native_catalog.ue2 import FormatError
from world.map_actor_properties import property_value
from world.map_sources import file_hash, require_lock_equal_client_path, safe_path, sha
from world.terrain_coordinates import f32, xyz

CLASS_EVIDENCE_REFERENCES = ('Engine.Actor', 'Engine.StaticMeshActor', 'Engine.TerrainInfo')
CLASS_DEFAULT_HELPER_PATH = Path(__file__).resolve().parents[1] / 'native_catalog' / 'extract_ue_defaults.ps1'


def read_class_evidence(client, work, reusable=None):
    from native_catalog.effects import read_class_defaults, parse_uc, UELIB, UELIB_SHA256
    if file_hash(UELIB) != UELIB_SHA256:
        raise FormatError('Class parser differs from pinned UELib')
    evidence = {}
    for reference in CLASS_EVIDENCE_REFERENCES:
        base = Path(reusable)/reference if reusable else None
        if base and (base/'defaults.json').is_file():
            result = json.loads((base/'defaults.json').read_text(encoding='utf-8'))
            script = safe_path(base, result['sourceScript']).read_bytes()
            if sha(script) != result['sourceScriptSha256'] or file_hash(require_lock_equal_client_path(client, result['source']['package'])) != result['source']['packageSha256']:
                raise FormatError('Reused native class evidence no longer matches sources')
        else:
            base = work/reference
            result = read_class_defaults(client, reference, base)
            script = safe_path(base, result['sourceScript']).read_bytes()
        parsed = parse_uc(script.decode('utf-8-sig'), reference)
        if result['source']['object'] != reference or result['uelibSha256'] != UELIB_SHA256 or result['helperSha256'] != file_hash(CLASS_DEFAULT_HELPER_PATH):
            raise FormatError('Native class evidence reader/source identity differs')
        if parsed['unparsed'] or parsed['properties'] != result['properties'] or parsed['superClass'] != result['superClass']:
            raise FormatError('Native class evidence differs from its retained script')
        evidence[reference] = {'defaults': result['properties'], 'superClass': result['superClass'], 'source': result['source'],
                               'sourceScriptSha256': result['sourceScriptSha256'], 'sourceScript': script.decode('utf-8-sig'),
                               'uelibSha256': result['uelibSha256'], 'helperSha256': result['helperSha256']}
    actor_script = evidence['Engine.Actor']['sourceScript']
    for name, kind in (('Location', 'Vector'), ('Rotation', 'Rotator'), ('PrePivot', 'Vector')):
        if not re.search(r'\bvar[^;\n]*\b'+kind+r'\s+'+name+r'\s*;', actor_script):
            raise FormatError('Zero-initialized actor field declaration not established: '+name)
    if not re.search(r'\bvar[^;\n]*\bbool\s+Inverted\s*;', evidence['Engine.TerrainInfo']['sourceScript']):
        raise FormatError('Terrain Inverted declaration is not established')
    return evidence


def require_terrain_not_inverted(terrain_actor, evidence):
    inverted = property_value(terrain_actor['properties'], 'Inverted')
    if inverted is None:
        inverted = evidence['Engine.TerrainInfo']['defaults'].get('Inverted', False)
    if inverted:
        raise FormatError('Inverted terrain requires separately verified rendering/normals')


def resolved_static_values(actor, evidence):
    if actor['classObject'] != 'Engine.StaticMeshActor' or evidence['Engine.StaticMeshActor']['superClass'] != 'Actor':
        raise FormatError('Only exact native Engine.StaticMeshActor inheritance is supported')
    base, child = evidence['Engine.Actor']['defaults'], evidence['Engine.StaticMeshActor']['defaults']
    result = {}
    for name in ('Location', 'Rotation', 'PrePivot', 'DrawScale', 'DrawScale3D'):
        field = actor['sourceTransform'][name]
        if field['status'] == 'serialized':
            result[name] = {'value': field['value'], 'source': 'serialized-actor-property'}
        elif name in child or name in base:
            value = child[name] if name in child else base[name]
            result[name] = {'value': value, 'source': 'Engine.StaticMeshActor' if name in child else 'Engine.Actor'}
        elif name in ('Location', 'Rotation', 'PrePivot'):
            labels = ('Pitch', 'Yaw', 'Roll') if name == 'Rotation' else tuple('XYZ')
            result[name] = {'value': dict.fromkeys(labels, 0), 'source': 'native-declared-field-zero-init',
                            'evidence': 'Exact Engine.Actor declaration + no base/child override; UObject::InitProperties zero-fills newly declared fields'}
        else:
            raise FormatError('Native default is unresolved: '+name)
    return result


def rotation_rows(rotation):
    def sine(value):
        index = (int(value) >> 2) & 16383
        return f32(math.sin(index*2*math.pi/16384))
    p, y, r = (rotation[name] for name in ('Pitch', 'Yaw', 'Roll'))
    sp, sy, sr, cp, cy, cr = sine(p), sine(y), sine(r), sine(p+16384), sine(y+16384), sine(r+16384)
    return [[cp*cy, cp*sy, sp], [sr*sp*cy-cr*sy, sr*sp*sy+cr*cy, -sr*cp],
            [-(cr*sp*cy+sr*sy), cy*sr-cr*sp*sy, cr*cp]]


def static_matrix(values):
    location, pivot, scale3 = (xyz(values[name]['value']) for name in ('Location', 'PrePivot', 'DrawScale3D'))
    uniform = values['DrawScale']['value']
    if not math.isfinite(uniform) or uniform == 0 or any(v == 0 for v in scale3):
        raise FormatError('Singular static actor scale')
    rotation = rotation_rows(values['Rotation']['value'])
    rows = [[rotation[i][j]*scale3[i]*uniform for j in range(3)]+[0] for i in range(3)]
    rows.append([location[j]-sum(pivot[i]*rows[i][j] for i in range(3)) for j in range(3)]+[1])
    return rows


def gltf_placement(native_rows):
    umodel_xzy_basis_permutation = (0, 2, 1)
    result = [[native_rows[umodel_xzy_basis_permutation[i]][umodel_xzy_basis_permutation[j]] for j in range(3)]+[0] for i in range(3)]
    result.append([native_rows[3][axis]*.01 for axis in umodel_xzy_basis_permutation]+[1])
    native_row_major_as_gltf_column_major = [v for row in result for v in row]
    return native_row_major_as_gltf_column_major
