"""Explicit raw material preservation; diagnostic slots never impersonate a shader."""
import hashlib
from pathlib import Path

from native_assets_lib.gltf import json_bytes, safe_name
from native_assets_lib.texture_mips import build_texture_source, UnsupportedTextureSource
from native_assets_lib.texture_dds import build_texture_dds, UnsupportedTextureDDS
from native_catalog.effects import SourcePackages, references
from native_catalog.ue2 import FormatError

POLICY = 'preserve-native-graph'
REVIEWED_NODE_CLASSES = {'Texture', 'Shader', 'Combiner', 'FadeColor', 'Palette'}
MAX_NODES = 128
MANIFEST = 'native-materials/graph.json'
RUNTIME_GAPS = ['native-billboarding', 'texture-AnimNext-timing', 'FadeColor-phase-and-period',
                'Combiner-color-alpha-operations', 'native-Shader-output-blending']


def _require(condition, message):
    if not condition:
        raise FormatError(message)


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def preserve_material_graph(converter, work, document, source_item, native_materials):
    """Return slots, limitations, graph summary and archive files; source is read-only.

    Only invoked by an explicit exact StaticMesh request policy. Supported
    material classes here mean source preservation, never runtime evaluation.
    """
    # Reuse proven fixed-array and inheritance readers after native_assets has
    # loaded; native_effect_bundle imports Converter and cannot be imported early.
    from native_effect_bundle import DefaultReader, object_values

    _require(source_item['classObject'] == 'Engine.StaticMesh', 'Raw material policy requires exact Engine.StaticMesh')
    native_slots = native_materials['slots']
    materials = document.data.get('materials', [])
    _require(len(native_slots) == len(materials), 'Diagnostic material count differs from original native slots')
    _require(all(slot['referenceStatus'] == 'exact-native-object-index' and slot['sourceReference'] for slot in native_slots),
             'Raw material graph requires explicit resolvable native slot roots')
    files = {}

    def save(name, data):
        path = 'native-materials/' + safe_name(name)
        _require(path not in files or files[path] == data, 'Conflicting raw material graph output')
        _require(type(data) is bytes, 'Raw material graph products must be bytes')
        files[path] = data
        _require(len(files) <= 248, 'Raw material graph exceeds bounded archive file budget')
        return path

    def record(name, data):
        return {'file': save(name, data), 'bytes': len(data), 'sha256': _sha(data)}

    packages = SourcePackages(converter.client)
    defaults = DefaultReader(converter.client, packages, Path(work)/'material-classes', save)
    pending = [slot['sourceReference'] for slot in native_slots]
    nodes, edges, gaps = {}, [], []
    while pending:
        reference = pending.pop(0)
        source, package, item = packages.resolve(reference)
        _require(source['resolution'] == 'exact-qualified-object', 'Raw material reference is not exact-qualified: ' + reference)
        key = item['object'].casefold()
        if key in nodes:
            continue
        _require(len(nodes) < MAX_NODES, 'Raw material graph exceeds native object limit')
        _require(item['className'] in REVIEWED_NODE_CLASSES, 'Unreviewed raw material graph class: ' + item['className'])
        tags, tail = package.properties(item)
        values = object_values(package, tags)
        raw = bytes(package.data[item['offset']:item['offset']+item['size']])
        identity = hashlib.sha256(item['object'].encode('utf-8')).hexdigest()[:24]
        node = {'source': source, 'propertyTags': tags, 'properties': values,
                'status': 'raw-source-preserved-runtime-unsupported',
                'trailingNativeBytes': tail.end-tail.position}
        nodes[key] = node
        if item['className'] != 'Palette':
            definition = defaults.get(item['classObject'])
            node['classDefinition'] = definition['object']
            for field, _, target in references(definition['effectiveProperties']):
                edges.append({'from': item['object'], 'field': 'inherited.'+field, 'to': target})
                pending.append(target)
        for tag in tags:
            if tag['type'] in (5, 8) and tag.get('value', {}).get('object'):
                target = tag['value']['object']
                edges.append({'from': item['object'], 'field': tag['name'], 'arrayIndex': tag['arrayIndex'], 'to': target})
                pending.append(target)
        if item['className'] == 'Texture':
            prefix = 'textures/' + identity + '/'
            texture_work = Path(work)/'material-textures'/identity
            texture_work.mkdir(parents=True, exist_ok=True)
            png, _, qualified = converter.texture(texture_work, item['object'])
            _require(qualified == item['object'], 'Texture export changed native graph identity')
            node['image'] = record(prefix+'texture.png', png)
            try:
                metadata, native_files = build_texture_source(package, item)
                if metadata['format']['propertyStatus'] == 'omitted-native-zero-default':
                    _, engine = converter.package('Engine')
                    _require(engine.source_hash == metadata['layout']['evidence']['omittedFormat']['enginePackageSha256'],
                             'Native texture omitted Format default pin differs')
                for name, data in native_files.items():
                    save(prefix+name, data)
                node['nativeTextureSource'] = {'status': 'preserved', 'manifest': 'native-materials/'+prefix+'native-texture-source.json',
                                               'mips': metadata['mipCount'], 'nativeMipBytes': metadata['nativeMipBytes']}
                node['rawExport'] = {'file': 'native-materials/'+prefix+'native/texture-export.bin', 'bytes': len(raw), 'sha256': _sha(raw)}
                _require(files[node['rawExport']['file']] == raw, 'Texture source export differs from original graph object')
                try:
                    derivative, derivative_files = build_texture_dds(metadata, native_files)
                    for name, data in derivative_files.items():
                        save(prefix+name, data)
                    node['dds'] = {'status': 'available', 'file': 'native-materials/'+prefix+derivative['file'],
                                   'manifest': 'native-materials/'+prefix+'native-texture-dds.json', 'sha256': derivative['sha256']}
                except UnsupportedTextureDDS as error:
                    node['dds'] = {'status': 'unsupported', 'reason': str(error)}
                    gaps.append({'object': item['object'], 'feature': 'texture-dds', 'reason': str(error)})
            except UnsupportedTextureSource as error:
                node['rawExport'] = record('objects/'+identity+'.bin', raw)
                node['nativeTextureSource'] = {'status': 'unsupported-layout', 'reason': str(error), 'originalExportRetained': True}
                node['dds'] = {'status': 'unsupported', 'reason': 'Native mip layout is not supported'}
                gaps.append({'object': item['object'], 'feature': 'texture-native-mips-dds', 'reason': str(error)})
        else:
            node['rawExport'] = record('objects/'+identity+'.bin', raw)
    for path, package in packages.loaded.values():
        _require(_sha(path.read_bytes()) == package.source_hash, 'Material graph dependency changed during extraction')
        converter.source(path)
    class_definitions = [defaults.definitions[key] for key in sorted(defaults.definitions)]
    for definition in class_definitions:
        save('source/classes/'+definition['object']+'.json', json_bytes(definition))
    graph = {'schemaVersion': 1, 'kind': 'native-material-graph', 'sourceMesh': source_item['object'],
             'policy': POLICY, 'runtimeStatus': 'unsupported-diagnostic', 'runtimeImplemented': False,
             'roots': [{'slot': slot['slot'], 'object': slot['sourceReference']} for slot in native_slots],
             'nativeMeshPropertyTags': native_materials['meshPropertyTags'],
             'nodes': [nodes[key] for key in sorted(nodes)], 'edges': edges,
             'classDefinitions': [definition['object'] for definition in class_definitions],
             'runtimeGaps': list(RUNTIME_GAPS), 'textureGaps': gaps,
             'sourcePolicy': 'All source tags, original exports and relationships retained; no graph flattening, diffuse selection, timing synthesis or native material evaluation.'}
    save('graph.json', json_bytes(graph))
    slots = []
    for index, (material, slot) in enumerate(zip(materials, native_slots)):
        material.clear()
        material.update(name=f'UNSUPPORTED_NATIVE_GRAPH_SLOT_{index}',
                        pbrMetallicRoughness={'baseColorFactor': [1, 0, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 1},
                        extras={'nativeMaterialGraph': MANIFEST, 'nativeMaterialRoot': slot['sourceReference'],
                                'nativeRuntimeStatus': 'unsupported-diagnostic', 'nativeSectionIndex': index,
                                'nativeSourceReference': slot['sourceReference'], 'nativeSlotProperties': slot['properties']})
        slots.append({'slot': index, 'sourceReference': slot['sourceReference'], 'binding': 'explicit-preserve-native-graph',
                      'nativeSectionIndex': index, 'nativeMaterialSlot': slot,
                      'nativeReferenceStatus': slot['referenceStatus'], 'nativeMaterialGraphManifest': MANIFEST,
                      'nativeRuntimeStatus': 'unsupported-diagnostic'})
    summary = {'manifest': MANIFEST, 'runtimeStatus': 'unsupported-diagnostic', 'runtimeImplemented': False,
               'sourceMesh': source_item['object'], 'nodes': len(nodes), 'classDefinitions': len(class_definitions),
               'textureImages': sum(node['source']['class'] == 'Texture' for node in nodes.values()),
               'ddsTextures': sum(node.get('dds', {}).get('status') == 'available' for node in nodes.values()),
               'runtimeGaps': list(RUNTIME_GAPS), 'textureGaps': gaps}
    limits = ['Explicit raw material graph policy: original geometry and native material relationships are retained; magenta slots are named diagnostics, not native materials.',
              'Pending Babylon behavior: native billboarding, AnimNext frame selection/rates, FadeColor timing, Combiner operations and Shader output blends.']
    limits.extend('Raw material texture gap '+row['object']+': '+row['reason'] for row in gaps)
    return slots, limits, summary, files
