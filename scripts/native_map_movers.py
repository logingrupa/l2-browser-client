"""Source-qualified Engine.Mover extraction for the retained Interlude 20_20 map.

This adapter is deliberately separate from StaticMeshActor conversion. It keeps
all indexed keys and source tags, and derives rigid endpoints from the exact
Mover inheritance and decompiled native operator identities. It does not assign
server permissions, interaction distance, automatic closing, or sound dispatch.
"""
import copy
import hashlib
import json
import math
from pathlib import Path
import re
import zipfile

from native_assets import Converter, UMODEL, UMODEL_SHA256, verify_archive
from native_assets_lib.gltf import json_bytes
from native_catalog.effects import SourcePackages, UELIB_SHA256, parse_uc
from native_catalog.ue2 import FormatError
from native_effect_bundle import DefaultReader
from native_map import (MapSources, TRANSFORMS, actor_properties, decode_property,
                        file_hash, safe_path, source_range)
from native_map_geometry import gltf_placement, static_matrix

ROOT = Path(__file__).resolve().parents[1]
MAP_PATH = 'maps/20_20.unr'
MAP_SHA = '1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4'
MESH_PATH = 'staticmeshes/l2fortress_02_s.usx'
MESH_SHA = '1049a1075c90cdd3ecb9d739eb1828ffead45b3ad52661079552e60fe3b608b6'
ENGINE_SHA = '9b04ff5cb4258e84dfa8efbdd85d9121f3bdcb5822a9a21ca69d200d05a69761'
ACTORS = ('Mover1', 'Mover61', 'Mover60', 'Mover195', 'Mover194', 'Mover193', 'Mover192', 'Mover24')
MESHES = ('l2fortress_02_s.Fort02_indoor', 'l2fortress_02_s.fort02_wall_door')
RAW_MAP = 'source/map.unwrapped.bin'
ARRAYS = {'KeyPos': ('Vector', 8), 'KeyRot': ('Rotator', 8),
          'MeshGrade': ('StaticMesh', 7), 'RangeDelta': ('Vector', 4)}


def require(value, message):
    if not value:
        raise FormatError(message)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def immutable_write(output, name, value):
    path = safe_path(output, name)
    if path.exists():
        require(path.read_bytes() == value, 'Existing mover output differs: ' + name)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)
    return name


def source_record(relative, package, item):
    raw = package.data[item['offset']:item['offset'] + item['size']]
    return {'package': relative, 'packageSha256': package.source_hash,
            'object': item['object'], 'classObject': item['classObject'],
            'exportIndex': item['exportIndex'], 'exportOffset': item['offset'],
            'exportBytes': len(raw), 'exportSha256': sha(raw)}


def qualified_classes(definitions, read):
    """Verify exact inherited classes, script/default parity, and key semantics."""
    require(set(definitions) == {'core.object', 'engine.actor', 'engine.mover'},
            'Unsupported Engine.Mover inheritance census')
    scripts = {}
    for key, definition in definitions.items():
        script = read(definition['sourceScript'])
        require(sha(script) == definition['sourceScriptSha256'] and
                definition['uelibSha256'] == UELIB_SHA256 and
                definition['helperSha256'] == file_hash(ROOT/'scripts/native_catalog/extract_ue_defaults.ps1'),
                'Class evidence parser/script changed: ' + key)
        parsed = parse_uc(script.decode('utf-8-sig'), definition['object'])
        require(not parsed['unparsed'] and parsed['properties'] == definition['properties'] and
                parsed['superClass'] == definition['superClass'],
                'Class defaults disagree with retained script: ' + key)
        scripts[key] = script.decode('utf-8-sig')
    require(definitions['engine.mover']['nativeSuperClass'] == 'Engine.Actor' and
            definitions['engine.actor']['nativeSuperClass'] == 'Core.Object' and
            definitions['core.object']['nativeSuperClass'] is None,
            'Exact Engine.Mover native superclass chain changed')
    require(definitions['engine.mover']['source']['packageSha256'] == ENGINE_SHA,
            'Engine.Mover package pin changed')
    checks = {
        'core.object': (r'native\(215\).*Vector\s+\+\(Vector A, Vector B\)',
                        r'native\(216\).*Vector\s+-\(Vector A, Vector B\)',
                        r'native\(316\).*Rotator\s+\+\(Rotator A, Rotator B\)',
                        r'native\(147\).*int\s+-\(int A, int B\)',
                        r'native\(250\).*int Max\(int A, int B\)'),
        'engine.actor': (r'native\(266\).*bool Move\(Vector Delta\)',
                         r'native\(299\).*bool SetRotation\(Rotator NewRotation\)'),
        'engine.mover': (r'__NFUN_266__\(__NFUN_216__\(__NFUN_215__\(BasePos, KeyPos\[int\(KeyNum\)\]\), Location\)\)',
                         r'__NFUN_299__\(__NFUN_316__\(BaseRot, KeyRot\[int\(KeyNum\)\]\)\)',
                         r'InterpolateTo\(1, MoveTime\)',
                         r'InterpolateTo\(byte\(__NFUN_250__\(0, __NFUN_147__\(int\(KeyNum\), 1\)\)\), MoveTime\)')}
    for key, patterns in checks.items():
        for pattern in patterns:
            require(re.search(pattern, scripts[key]), 'Unqualified native mover endpoint semantics: ' + pattern)
    return scripts


class MoverDefaults:
    def __init__(self, definitions, scripts):
        self.definitions, self.scripts = definitions, scripts

    def declaration(self, name, kind, count=None):
        suffix = r'\['+str(count)+r'\]' if count is not None else ''
        # UELib emits class fields at column zero and struct members indented.
        # Core.Object also has a nested struct Location; it is not Actor.Location.
        pattern = r'^var[^;\n]*\b'+re.escape(kind)+r'\s+'+name+suffix+r'\s*;'
        matches = [key for key, script in self.scripts.items() if re.search(pattern, script, re.MULTILINE)]
        require(len(matches) == 1, 'Native mover field declaration unresolved: ' + name)
        return matches[0]

    def resolve(self, properties, name, kind, index=None, count=None):
        key = (name, index)
        self.declaration(name, kind, count)
        if key in properties:
            prop = properties[key]
            require('value' in prop, 'Undecoded mover field: ' + name)
            return {'value': copy.deepcopy(prop['value']), 'source': 'serialized-actor-property',
                    'payload': prop['payload']}
        for class_key in ('engine.mover', 'engine.actor', 'core.object'):
            definition = self.definitions[class_key]
            value = definition['properties'].get(name)
            if name not in definition['properties']:
                continue
            if index is not None:
                require(isinstance(value, list), 'Native fixed array default is malformed: ' + name)
                if index >= len(value) or value[index] is None:
                    continue
                value = value[index]
            return {'value': copy.deepcopy(value), 'source': definition['object'],
                    'sourceScript': definition['sourceScript']}
        zero = {'Vector': dict.fromkeys('XYZ', 0), 'Rotator': dict.fromkeys(('Pitch', 'Yaw', 'Roll'), 0),
                'byte': 0, 'int': 0, 'bool': False}.get(kind)
        require(zero is not None, 'No qualified zero initialization: ' + name)
        return {'value': zero, 'source': 'native-declared-field-zero-init',
                'declaration': self.declaration(name, kind, count),
                'evidence': 'Exact native declared field without actor or inherited authored override; UObject field zero initialization.'}


def indexed_properties(tags):
    result = {}
    for prop in tags:
        index = prop['arrayIndex']
        if index is None and prop['name'] in ARRAYS:
            index = 0
        key = prop['name'], index
        require(key not in result, 'Duplicate native mover property path: ' + str(key))
        if prop['name'] in ARRAYS:
            require(type(index) is int and 0 <= index < ARRAYS[prop['name']][1],
                    'Native mover fixed array index outside declaration')
        result[key] = prop
    return result


def numeric_struct(value, kind):
    axes = ('Pitch', 'Yaw', 'Roll') if kind == 'Rotator' else tuple('XYZ')
    require(isinstance(value, dict) and set(value) == set(axes) and
            all(type(value[axis]) in (int, float) and math.isfinite(value[axis]) for axis in axes),
            'Invalid native mover numeric struct: ' + kind)
    if kind == 'Rotator':
        require(all(type(value[axis]) is int for axis in axes), 'Noninteger native mover rotator')
    return value


def endpoint_matrix(base_pos, base_rot, key_pos, key_rot, transforms):
    """Mover.BeginPlay: BasePos + KeyPos; BaseRot + KeyRot (native operators)."""
    values = copy.deepcopy(transforms)
    values['Location']['value'] = {axis: numeric_struct(base_pos, 'Vector')[axis] +
        numeric_struct(key_pos, 'Vector')[axis] for axis in 'XYZ'}
    values['Rotation']['value'] = {axis: numeric_struct(base_rot, 'Rotator')[axis] +
        numeric_struct(key_rot, 'Rotator')[axis] for axis in ('Pitch', 'Yaw', 'Roll')}
    return gltf_placement(static_matrix(values))


def collect_movers(sources, defaults):
    package = sources.get(MAP_PATH)
    require(package.source_hash == MAP_SHA, 'Mover extraction requires the pinned original 20_20 map')
    items = [item for item in package.exports if item['classObject'] == 'Engine.Mover']
    require(tuple(item['name'] for item in items) == ACTORS, 'Exact native mover census changed')
    movers, meshes = [], {}
    for item in items:
        tags, tail, state, prefix_end = actor_properties(package, item)
        require(tail.position == tail.end, 'Native mover has an unqualified native tail')
        raw = [decode_property(package, prop, RAW_MAP) for prop in tags]
        props = indexed_properties(raw)
        resolved = {}
        for name in TRANSFORMS:
            kind = 'Rotator' if name == 'Rotation' else 'float' if name == 'DrawScale' else 'Vector'
            resolved[name] = defaults.resolve(props, name, kind)
        for name, kind in (('BasePos', 'Vector'), ('BaseRot', 'Rotator'), ('KeyNum', 'byte'),
                           ('NumKeys', 'byte'), ('MoveTime', 'float'), ('StayOpenTime', 'float'),
                           ('bClosed', 'bool'), ('L2ServerObjectRealID', 'int'),
                           ('L2ServerObjectID', 'int'), ('L2ServerObjectType', 'Actor.EL2ObjectType')):
            resolved[name] = defaults.resolve(props, name, kind)
        num_keys, initial = resolved['NumKeys']['value'], resolved['KeyNum']['value']
        require(num_keys == 2 and initial == 0 and resolved['bClosed']['value'] is True,
                'Only source-qualified initially closed two-key movers are supported')
        duration = resolved['MoveTime']['value']
        require(type(duration) in (int, float) and math.isfinite(duration) and duration > 0,
                'Invalid native mover MoveTime')
        keys = []
        for index in range(8):
            pos = defaults.resolve(props, 'KeyPos', 'Vector', index, 8)
            rot = defaults.resolve(props, 'KeyRot', 'Rotator', index, 8)
            keys.append({'index': index, 'active': index < num_keys, 'position': pos, 'rotation': rot,
                'matrix': endpoint_matrix(resolved['BasePos']['value'], resolved['BaseRot']['value'],
                    pos['value'], rot['value'], resolved)})
        require(all(abs(a-b) < 1e-8 for a, b in zip(keys[initial]['matrix'], gltf_placement(static_matrix(resolved)))),
                'Saved actor placement differs from qualified initial mover key')
        reference = props.get(('StaticMesh', None), {}).get('value', {}).get('object')
        require(isinstance(reference, str), 'Mover has no serialized source StaticMesh')
        relative, mesh_package, mesh = sources.resolve(reference, 'StaticMesh')
        require(relative == MESH_PATH and mesh_package.source_hash == MESH_SHA and mesh['object'] in MESHES,
                'Unqualified native mover mesh')
        model_id = 'interlude:' + mesh['object']
        meshes[model_id] = source_record(relative, mesh_package, mesh)
        movers.append({'id': 'interlude:' + item['object'], 'actorName': item['name'], 'modelId': model_id,
            'serverObject': {'realId': resolved['L2ServerObjectRealID']['value'],
                             'id': resolved['L2ServerObjectID']['value'], 'type': resolved['L2ServerObjectType']['value']},
            'closedMatrix': keys[0]['matrix'], 'openMatrix': keys[1]['matrix'],
            'moveTimeSeconds': duration, 'initialKey': initial, 'initiallyClosed': True,
            'keys': keys, 'resolvedProperties': resolved,
            'meshGrades': [{'index': index, **copy.deepcopy(prop)} for (name, index), prop in props.items() if name == 'MeshGrade'],
            'sounds': [copy.deepcopy(prop) for prop in raw if prop['name'].endswith('Sound') or prop['name'].endswith('Sounds')],
            'rawProperties': raw, 'source': {**source_record(MAP_PATH, package, item),
                'nativePayload': source_range(package.data, RAW_MAP, item['offset'], item['offset']+item['size']),
                'stateFrame': state, 'stateFrameBytes': prefix_end-item['offset'], 'nativeTailBytes': 0}})
    require(set(meshes) == {'interlude:' + name for name in MESHES}, 'Expected exactly two native mover meshes')
    return movers, meshes


def load_defaults(client, output, save):
    reader = DefaultReader(client, SourcePackages(client), output/'.work', save)
    reader.get('Engine.Mover')
    definitions = reader.definitions
    scripts = qualified_classes(definitions, lambda name: safe_path(output, name).read_bytes())
    for definition in definitions.values():
        source = definition['source']
        require(file_hash(safe_path(client, source['package'])) == source['packageSha256'],
                'Source class package changed')
        raw = safe_path(output, definition['rawExport']).read_bytes()
        require(len(raw) == source['sourceBytes'], 'Class raw export length differs')
    return definitions, MoverDefaults(definitions, scripts)


def export(client, output, umodel=UMODEL):
    client, output = Path(client).resolve(strict=True), Path(output).resolve()
    require(output != client and not output.is_relative_to(client) and not client.is_relative_to(output),
            'Mover output overlaps read-only native source')
    require(output.is_relative_to(ROOT/'artifacts') and output != ROOT/'artifacts',
            'Mover extraction output must be dedicated artifacts scratch')
    output.mkdir(parents=True, exist_ok=True)
    files = {}

    def save(name, value):
        immutable_write(output, name, value)
        files[name] = {'sha256': sha(value), 'bytes': len(value)}
        return name

    definitions, defaults = load_defaults(client, output, save)
    save('class-evidence.json', json_bytes(definitions))
    sources = MapSources(client)
    movers, mesh_sources = collect_movers(sources, defaults)
    package = sources.get(MAP_PATH)
    save(RAW_MAP, package.data)
    converter = Converter(client, output/'.work/converter', umodel)
    models = []
    dependencies = dict(sources.dependencies)
    for model_id, source in sorted(mesh_sources.items()):
        result = converter.convert({'kind': 'model', 'package': source['package'], 'object': source['object']})
        archive = Path(result['file'])
        checked = verify_archive(archive)
        require(checked['id'] == model_id, 'Converted mover model identity differs')
        prefix = 'models/' + checked['sha256'] + '/'
        with zipfile.ZipFile(archive) as zipped:
            manifest = json.loads(zipped.read('asset.json'))
            for item in manifest['files']:
                save(prefix + item['path'], zipped.read(item['path']))
            save(prefix + 'asset.json', zipped.read('asset.json'))
            provenance = json.loads(zipped.read('provenance.json'))
            for path, digest in provenance['dependencies'].items():
                entry = {'sha256': digest, 'bytes': safe_path(client, path).stat().st_size}
                require(path not in dependencies or dependencies[path] == entry, 'Model dependency changed')
                dependencies[path] = entry
            limitations = manifest['limitations']
        save(prefix + 'asset.l2asset', archive.read_bytes())
        relative, mesh_package, mesh = sources.resolve(source['object'], 'StaticMesh')
        save('source/meshes/' + source['object'] + '.bin', mesh_package.data[mesh['offset']:mesh['offset']+mesh['size']])
        models.append({'id': model_id, 'sourceObject': source['object'], 'source': source,
            'model': {'file': prefix+'model.glb', **files[prefix+'model.glb']},
            'archive': {'file': prefix+'asset.l2asset', **files[prefix+'asset.l2asset']},
            'limitations': limitations})
    for definition in definitions.values():
        source = definition['source']
        dependencies[source['package']] = {'sha256': source['packageSha256'],
            'bytes': safe_path(client, source['package']).stat().st_size}
    descriptor = {'schemaVersion': 1, 'kind': 'native-map-movers',
        'sourceMap': {'object': '20_20', 'package': MAP_PATH, 'packageSha256': MAP_SHA},
        'models': models, 'movers': movers, 'classEvidence': definitions,
        'transformConvention': 'glTF column-major; original local mesh coordinates X,Z,Y in metres; native BasePos+KeyPos and BaseRot+KeyRot; native PrePivot preserved',
        'sourceFiles': dependencies,
        'limitations': ['Native server permission, packet handling and runtime replication are not implemented by extraction.',
            'MoveTime and StayOpenTime are authored/inherited evidence; interaction range, interpolation policy and automatic closing are runtime policy.',
            'MeshGrade, RangeDelta, original sound references and undecoded payloads are preserved without inferred selection or dispatch.']}
    save('movers.json', json_bytes(descriptor))
    for path, record in dependencies.items():
        native = safe_path(client, path)
        require(file_hash(native) == record['sha256'] and native.stat().st_size == record['bytes'],
                'Native source changed during mover extraction: ' + path)
    receipt = {'schemaVersion': 1, 'kind': 'native-map-movers-bundle',
        'descriptor': {'file': 'movers.json', **files['movers.json']},
        'counts': {'movers': len(movers), 'models': len(models)}, 'files': files,
        'implementation': {name: file_hash(ROOT/'scripts'/name) for name in
            ('native_map_movers.py', 'derive-native-map-movers.py')}, 'umodelSha256': UMODEL_SHA256,
        'sourceFiles': dependencies}
    immutable_write(output, 'bundle.json', json_bytes(receipt))
    return {'status': 'prepared', 'descriptor': receipt['descriptor'], 'counts': receipt['counts'],
            'bundleSha256': file_hash(output/'bundle.json')}
