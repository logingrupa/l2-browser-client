"""Read retained native-effect bundles; do not execute native or browser code.

Resource identity is compared with converted GLB primitives/materials. Neither
declared source pins nor retained effective defaults are re-derived from originals.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path, PurePosixPath
import struct

from native_assets_lib.gltf import json_bytes
from stage_native_players import checked, child, decode, digest, relative_name, require, HASH

ENUM_FIELDS = {
    'DrawStyle': 'EParticleDrawStyle', 'CoordinateSystem': 'EParticleCoordinateSystem',
    'UseDirectionAs': 'EParticleDirectionUsage', 'GetVelocityDirectionFrom': 'EParticleVelocityDirection',
    'StartLocationShape': 'EParticleStartLocationShape', 'RotationSource': 'EParticleRotationSource',
}
LIMITS = [
    'Resource-ready does not mean runtime-playable. This inspector implements no particle or audio playback.',
    'Original source files, native binaries and tools are not opened. Source pins and source-dispatch claims are retained, not re-certified.',
    'Effective properties are retained bundle values; constructor defaults and inheritance are not independently re-derived.',
    'Enum labels do not prove blend equations, interpolation, distributions, spin units or velocity-loss integration.',
    'Timing, attachment, random selection, replay, cleanup and gameplay dispatch remain unimplemented here.',
    'Declared file hashes and extracted asset identities are checked; archives are not unpacked and this is not a full glTF validator.',
    'GLB material comparisons cover primitive base-color texture routes, not arbitrary shader graphs or native material equations.',
    'No browser loading, WebGPU execution, audible output or native visual parity is certified.',
]


def indexed(rows, key, label):
    require(isinstance(rows, list), 'Expected list: ' + label)
    result = {}
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get(key), str) and row[key], 'Invalid identity: ' + label)
        name = row[key].casefold()
        require(name not in result, 'Duplicate/ambiguous ' + label + ': ' + row[key])
        result[name] = row
    return result


class Bundle:
    def __init__(self, path):
        path = checked(path)
        self.root = path if path.is_dir() else path.parent
        manifest_path = child(self.root, 'manifest.json')
        require(path.is_dir() or path == manifest_path, 'Expected bundle directory or manifest.json')
        self.manifest_bytes = manifest_path.read_bytes()
        self.manifest = decode(self.manifest_bytes, max_bytes=32 * 1024 * 1024)
        require(self.manifest.get('schemaVersion') == 1 and self.manifest.get('kind') == 'native-effect-bundle',
                'Unsupported effect bundle schema')
        self.files = {}; self.snapshots = {'manifest.json': digest(self.manifest_bytes)}
        for spec in self.manifest['files']:
            name = relative_name(spec['file']); key = name.casefold()
            require(key != 'manifest.json' and key not in self.files, 'Duplicate declared output: ' + name)
            require(type(spec.get('bytes')) is int and spec['bytes'] >= 0 and
                    isinstance(spec.get('sha256'), str) and HASH.fullmatch(spec['sha256']), 'Invalid file pin: ' + name)
            data = child(self.root, name).read_bytes()
            require(len(data) == spec['bytes'] and digest(data) == spec['sha256'], 'Declared file bytes/hash differ: ' + name)
            self.files[key] = spec; self.snapshots[name] = spec['sha256']
        # Also refuse case-insensitive file/directory collisions on POSIX hosts.
        for name in self.files:
            require(not any(str(p) in self.files for p in PurePosixPath(name).parents if str(p) != '.'),
                    'Conflicting declared output paths: ' + name)

    def read(self, name):
        name = relative_name(name)
        spec = self.files.get(name.casefold())
        require(spec is not None and spec['file'] == name, 'Undeclared or differently cased bundle reference: ' + name)
        data = child(self.root, name).read_bytes()
        require(len(data) == spec['bytes'] and digest(data) == spec['sha256'], 'Bundle changed during inspection: ' + name)
        return data

    def json(self, name):
        return decode(self.read(name), max_bytes=96 * 1024 * 1024)

    def unchanged(self):
        for name, expected in self.snapshots.items():
            require(digest(child(self.root, name).read_bytes()) == expected, 'Bundle changed during inspection: ' + name)


def asset_records(bundle):
    assets = indexed(bundle.manifest['assets'], 'object', 'asset object')
    indexed(list(assets.values()), 'id', 'asset ID')
    claimed = set(); records = {}
    for key, item in assets.items():
        for field in ('manifest', 'archive', 'primary'):
            name = relative_name(item[field])
            require(name.casefold() not in claimed, 'Duplicate asset output reference: ' + name)
            claimed.add(name.casefold()); bundle.read(name)
        require(digest(bundle.read(item['archive'])) == item['archiveSha256'], 'Asset archive hash differs')
        asset = bundle.json(item['manifest'])
        require(asset.get('schemaVersion') == 1 and asset['id'] == item['id'] and asset['kind'] == item['kind'] and
                asset['source']['object'].casefold() == key, 'Converted asset identity differs: ' + item['object'])
        prefix = PurePosixPath(item['manifest']).parent
        internal = set()
        for file in asset['files']:
            name = relative_name(file['path'])
            require(name.casefold() not in internal, 'Duplicate asset payload: ' + name)
            internal.add(name.casefold()); raw = bundle.read((prefix / name).as_posix())
            require(type(file.get('bytes')) is int and len(raw) == file['bytes'] and digest(raw) == file['sha256'],
                    'Asset payload pin differs: ' + name)
        kind_field = {'model': 'model', 'texture': 'image', 'audio': 'audio'}.get(item['kind'])
        if kind_field:
            primary = relative_name(asset[kind_field]['file'])
            require(primary.casefold() in internal and (prefix / primary).as_posix() == item['primary'], 'Asset primary binding differs')
        records[key] = {'object': item['object'], 'id': item['id'], 'kind': item['kind'], 'source': asset['source'],
                        'manifest': item['manifest'], 'primary': item['primary'], 'primarySha256': digest(bundle.read(item['primary'])),
                        'archive': item['archive'], 'archiveSha256': item['archiveSha256'], 'limitations': item.get('limitations', [])}
    return records


def at(rows, index, label):
    require(isinstance(rows, list) and type(index) is int and 0 <= index < len(rows), 'Invalid GLB ' + label + ' index')
    return rows[index]


def glb_materials(raw, assets):
    require(len(raw) >= 20 and struct.unpack_from('<III', raw) == (0x46546c67, 2, len(raw)), 'Invalid GLB header')
    pos = 12; chunks = []
    while pos < len(raw):
        require(pos + 8 <= len(raw), 'Truncated GLB chunk')
        size, kind = struct.unpack_from('<II', raw, pos); pos += 8
        require(size % 4 == 0 and pos + size <= len(raw), 'Invalid GLB chunk length')
        chunks.append((kind, raw[pos:pos + size])); pos += size
    require(chunks and chunks[0][0] == 0x4e4f534a and len(chunks) <= 2 and
            (len(chunks) == 1 or chunks[1][0] == 0x004e4942), 'Unsupported GLB chunks')
    doc = decode(chunks[0][1], max_bytes=96 * 1024 * 1024)
    require(doc.get('asset', {}).get('version') == '2.0', 'Invalid glTF version')
    binary = chunks[1][1] if len(chunks) == 2 else b''
    result = []
    for mi, mesh in enumerate(doc.get('meshes', [])):
        for pi, primitive in enumerate(mesh.get('primitives', [])):
            index = primitive.get('material'); material = {} if index is None else at(doc.get('materials', []), index, 'material')
            source = material.get('extras', {}).get('nativeSourceReference')
            texture_asset = assets.get(source.casefold()) if isinstance(source, str) else None
            route = material.get('pbrMetallicRoughness', {}).get('baseColorTexture')
            image_info = None
            if route is not None:
                texture = at(doc.get('textures', []), route['index'], 'texture')
                image = at(doc.get('images', []), texture['source'], 'image')
                image_info = {'textureIndex': route['index'], 'imageIndex': texture['source'], 'name': image.get('name'),
                              'texCoord': route.get('texCoord', 0), 'extensions': texture.get('extensions', {}), 'sha256': None}
                if 'bufferView' in image:
                    view = at(doc.get('bufferViews', []), image['bufferView'], 'bufferView')
                    buf = at(doc.get('buffers', []), view.get('buffer', 0), 'buffer')
                    start, length = view.get('byteOffset', 0), view['byteLength']
                    require(view.get('buffer', 0) == 0 and 'uri' not in buf and type(start) is int and type(length) is int and
                            start >= 0 and length >= 0 and start + length <= buf['byteLength'] <= len(binary), 'Invalid embedded GLB image span')
                    image_info['sha256'] = digest(binary[start:start + length])
                    image_info['bytes'] = length
                else:
                    image_info['externalUriPreservedNotOpened'] = image.get('uri')
            matched = bool(texture_asset and texture_asset['kind'] == 'texture' and image_info and
                           image_info['sha256'] == texture_asset['primarySha256'])
            result.append({'meshIndex': mi, 'primitiveIndex': pi, 'attributes': primitive.get('attributes', {}),
                           'indices': primitive.get('indices'), 'mode': primitive.get('mode', 4), 'materialIndex': index,
                           'material': material, 'alphaMode': material.get('alphaMode', 'OPAQUE'),
                           'doubleSided': material.get('doubleSided', False), 'alphaCutoff': material.get('alphaCutoff', 0.5),
                           'nativeSourceReference': source, 'image': image_info,
                           'convertedTextureId': texture_asset['id'] if texture_asset else None,
                           'textureIdentityStatus': 'exact-converted-image-bytes' if matched else 'unproved-or-different-image-route'})
    return result


def object_references(value, pointer=''):
    if isinstance(value, dict):
        if isinstance(value.get('object'), str):
            yield pointer, value
        else:
            for key, item in value.items():
                yield from object_references(item, pointer + '/' + key.replace('~', '~0').replace('/', '~1'))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from object_references(item, pointer + '/' + str(index))


def enum_records(component, classes):
    chain = []; name = component['class']; seen = set()
    while name:
        candidates = [c for c in classes.values() if c['object'].casefold() == name.casefold() or
                      ('.' not in name and c.get('className', '').casefold() == name.casefold())]
        require(len(candidates) <= 1, 'Ambiguous class inheritance: ' + name)
        if not candidates: break
        row = candidates[0]; key = row['object'].casefold()
        require(key not in seen, 'Cyclic class inheritance'); seen.add(key); chain.append(row)
        name = row.get('superClass')
    values = []
    for field, enum_name in ENUM_FIELDS.items():
        if field not in component['effectiveProperties']: continue
        definitions = [(row['object'], row['enums'][enum_name]) for row in chain if enum_name in row.get('enums', {})]
        value = component['effectiveProperties'][field]
        values.append({'field': field, 'value': value, 'enum': enum_name,
                       'definitions': [{'classObject': owner, 'labels': [label for label, number in enums.items() if number == value]}
                                       for owner, enums in definitions], 'runtimeEquationVerified': False})
    return values


def inspect(bundle_path):
    bundle = Bundle(bundle_path); manifest = bundle.manifest
    graph_path = relative_name(manifest['sourceGraph']); graph = bundle.json(graph_path)
    require(graph.get('skillRow', {}).get('skill_id') == manifest.get('skillId') and
            graph.get('skillRow', {}).get('skill_level') == manifest.get('level'), 'Source graph skill binding differs')
    require(graph.get('associations') == manifest.get('associations'), 'Source graph associations differ')
    assets = asset_records(bundle); classes = indexed(graph.get('classDefaults', []), 'object', 'class definition')
    effects = indexed(graph.get('effects', []), 'object', 'effect actor')
    native = indexed([{'object': row['source']['object'], **row} for row in graph.get('nativeObjects', [])], 'object', 'native object')
    models = {key: glb_materials(bundle.read(row['primary']), assets) for key, row in assets.items() if row['kind'] == 'model'}
    actors = []; components = []; global_children = set()
    for ai, actor in enumerate(effects.values()):
        children = indexed(actor.get('children', []), 'name', 'emitter name')
        indexed(list(children.values()), 'object', 'emitter object')
        authored = actor.get('properties', {}).get('Emitters')
        effective = actor.get('effectiveProperties', {}).get('Emitters')
        order = authored if authored is not None else effective
        require(isinstance(order, list), 'Missing retained Emitters order: ' + actor['object'])
        ordered = []; selected = set()
        for symbol in order:
            require(isinstance(symbol, dict) and set(symbol) == {'symbol'} and isinstance(symbol['symbol'], str), 'Unsupported emitter symbol binding')
            key = symbol['symbol'].casefold()
            require(key in children and key not in selected, 'Missing/duplicate emitter symbol: ' + symbol['symbol'])
            selected.add(key); ordered.append(children[key])
        require(selected == set(children), 'Unreferenced/ambiguous emitter children')
        actors.append({'object': actor['object'], 'sourcePointer': f'/effects/{ai}', 'properties': actor.get('properties', {}),
                       'effectiveProperties': actor.get('effectiveProperties', {}), 'Emitters': order,
                       'orderSource': 'properties' if authored is not None else 'effectiveProperties',
                       'unparsed': actor.get('unparsed', []), 'runtimeImplemented': False})
        for ordinal, component in enumerate(ordered):
            identity = component['object'].casefold()
            require(identity not in global_children, 'Duplicate global emitter object'); global_children.add(identity)
            require(isinstance(component.get('properties'), dict) and isinstance(component.get('effectiveProperties'), dict), 'Missing component properties')
            properties = component['effectiveProperties']; refs = []
            for pointer, reference in object_references(properties):
                target = assets.get(reference['object'].casefold())
                refs.append({'propertyPointer': '/effectiveProperties' + pointer, 'reference': reference,
                             'convertedAssetId': target['id'] if target else None,
                             'status': 'converted-resource' if target else 'raw-native-only' if reference['object'].casefold() in native else 'unresolved'})
            mesh_ref = properties.get('StaticMesh', {}); texture_ref = properties.get('Texture', {})
            mesh = assets.get(mesh_ref.get('object', '').casefold()) if isinstance(mesh_ref, dict) else None
            texture = assets.get(texture_ref.get('object', '').casefold()) if isinstance(texture_ref, dict) else None
            primitives = models.get(mesh_ref.get('object', '').casefold(), []) if isinstance(mesh_ref, dict) else []
            if component['class'].casefold() == 'engine.meshemitter':
                ready = bool(mesh and mesh['kind'] == 'model' and primitives and all(p['textureIdentityStatus'] == 'exact-converted-image-bytes' for p in primitives))
                route = 'StaticMesh primitive material; inherited Texture is not substituted'
            elif component['class'].casefold() == 'engine.spriteemitter':
                ready = bool(texture and texture['kind'] == 'texture'); route = 'Texture reference'
            else:
                ready = False; route = 'unsupported emitter class; properties retained'
            source_index = actor['children'].index(component)
            components.append({'object': component['object'], 'class': component['class'], 'actor': actor['object'],
                               'emitterOrdinal': ordinal, 'sourcePointer': f'/effects/{ai}/children/{source_index}',
                               'properties': component['properties'], 'effectiveProperties': properties,
                               'enums': enum_records(component, classes), 'references': refs, 'primitiveMaterials': primitives,
                               'resourceRoute': route, 'resourceReady': ready, 'runtimePlayable': False,
                               'unimplementedEffectiveFields': sorted(k for k in properties if k not in ('Name', 'StaticMesh', 'Texture')),
                               'unparsed': component.get('unparsed', [])})
    textures = []
    for key, row in native.items():
        if row['source'].get('class') != 'Texture': continue
        textures.append({'object': row['object'], 'source': row['source'], 'properties': row.get('properties', {}),
                         'effectiveProperties': row.get('effectiveProperties', {}),
                         'animationProperties': {k: v for k, v in row.get('properties', {}).items() if k in ('AnimNext', 'MinFrameRate', 'MaxFrameRate', 'TotalFrameNum')},
                         'convertedAssetId': assets[key]['id'] if key in assets else None,
                         'loopInferred': False, 'runtimePlaybackImplemented': False})
    audio = [row for row in assets.values() if row['kind'] == 'audio']; sound_refs = []
    for field, value in graph.get('soundRow', {}).items():
        if not isinstance(value, str) or not value: continue
        exact = [a for a in audio if a['object'].casefold() == value.casefold()]
        parts = value.split('.')
        candidates = exact or ([a for a in audio if a['object'].split('.')[0].casefold() == parts[0].casefold() and
                              a['object'].split('.')[-1].casefold() == parts[-1].casefold()] if len(parts) == 2 else [])
        sound_refs.append({'field': field, 'rawReference': value, 'identityMatch': 'exact' if exact else 'package-leaf-candidate' if candidates else 'unresolved',
                           'candidates': [a['object'] for a in candidates], 'nativeLookupVerified': False, 'executable': False})
    report = {'schemaVersion': 1, 'kind': 'native-effect-resource-readiness', 'bundleId': manifest.get('id'),
              'inputs': {'manifest': {'file': 'manifest.json', 'sha256': digest(bundle.manifest_bytes)},
                         'sourceGraph': {'file': graph_path, 'sha256': digest(bundle.read(graph_path))}, 'declaredFilesVerified': len(bundle.files)},
              'sourceFiles': manifest.get('sourceFiles', []), 'associations': graph.get('associations', []),
              'sourceDispatch': graph.get('sourceDispatch'), 'stages': graph.get('stages', []),
              'stagePolicy': 'Preserved separately; no execution or inferred stage ordering.',
              'classEnums': [{'object': c['object'], 'superClass': c.get('superClass'), 'enums': c.get('enums', {})} for c in classes.values()],
              'actors': actors, 'components': components, 'assets': list(assets.values()), 'textureGraph': textures,
              'audio': {'soundRow': graph.get('soundRow'), 'references': sound_refs, 'runtimePlayable': False},
              'coverage': {'actors': len(actors), 'components': len(components), 'resourceReadyComponents': sum(c['resourceReady'] for c in components),
                           'runtimePlayableComponents': 0, 'convertedAssetsByKind': dict(sorted(Counter(a['kind'] for a in assets.values()).items())),
                           'unresolvedDependencies': len(graph.get('unresolvedDependencies', []))},
              'unresolvedDependencies': graph.get('unresolvedDependencies', []), 'bundleGaps': manifest.get('gaps', []),
              'bundleSupportClaims': manifest.get('support', {}), 'limits': LIMITS}
    return report, bundle


def run(bundle_path, output, *, verify=False):
    report, bundle = inspect(bundle_path); output = checked(output)
    require(output != bundle.root and not output.is_relative_to(bundle.root), 'Report output must stay outside the input bundle')
    data = json_bytes(report) + b'\n'
    bundle.unchanged()
    if output.exists():
        require(output.is_file() and output.read_bytes() == data, 'Existing report differs; preserved')
        status = 'verified' if verify else 'preserved'
    else:
        require(not verify, 'Verify requires an existing report')
        output.parent.mkdir(parents=True, exist_ok=True); checked(output.parent)
        with output.open('xb') as stream: stream.write(data)
        status = 'produced'
    return {'status': status, 'reportSha256': digest(data), 'coverage': report['coverage'], 'bundleUnchanged': True}
