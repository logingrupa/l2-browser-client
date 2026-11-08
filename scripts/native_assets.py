#!/usr/bin/env python3
import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import zipfile

from native_audio import decode_native_audio
from native_catalog.ue2 import Package
from native_assets_lib.gltf import Document, json_bytes, safe_name
from native_assets_lib.asset_manifest import asset_coordinates_record, build_asset_manifest, reference_client_build, require_supported_asset_manifest, source_path_record
from native_assets_lib.umodel_import_closure import index_package_files_by_casefolded_stem, require_lock_equal_import_closure, resolve_package_path
from native_assets_lib.animation import add_animations
from native_assets_lib.rigid import is_root_rigid, attach_rigid_part
from native_assets_lib.weights import restore_native_weights
from native_assets_lib.static_materials import native_static_materials
from native_assets_lib.texture_mips import build_texture_source, UnsupportedTextureSource
from native_assets_lib.texture_dds import build_texture_dds, UnsupportedTextureDDS
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, require_reference_client

CONVERTER_DESCRIPTION = 'Convert native Interlude client objects into reproducible .l2asset packages with the pinned UModel; see docs/ASSET_PIPELINE.md.'

UMODEL = Path('C:/laragon/www/lineagen/.assets/skill-assets/work/native/tools/umodel/umodel.exe')
UMODEL_SHA256 = '13502e5a4d8f6b5f32252afebd6360f7302ccfaccf6b8dda65beff0be2d364a0'
SOURCE_TO_GLTF = [.01, 0, 0, 0, 0, 0, .01, 0, 0, .01, 0, 0, 0, 0, 0, 1]
MAX_ARCHIVE = 128 * 1024 * 1024
MAX_PAYLOAD = 96 * 1024 * 1024


def static_section_bindings(document):
    meshes, materials = document.data.get('meshes', []), document.data.get('materials', [])
    if len(meshes) != 1:
        raise ValueError('Pinned static exporter must produce exactly one mesh')
    primitives = meshes[0].get('primitives', [])
    source_indices = list(range(len(primitives)))
    repairs = [row for row in document.repairs if row['kind'] == 'omit-empty-native-primitives']
    if len(repairs) > 1:
        raise ValueError('Static material binding cannot compose multiple primitive remaps')
    if repairs:
        repair = repairs[0]
        if not repair.get('materialSlotsPreserved') or repair.get('materialSlotCount') != len(materials):
            raise ValueError('Static primitive repair did not preserve native material slots')
        remaps = [row['oldToNew'] for row in repair['primitiveRemaps'] if row['mesh'] == 0]
        if len(remaps) > 1:
            raise ValueError('Ambiguous static primitive remap')
        if remaps:
            kept = [(new, old) for old, new in enumerate(remaps[0]) if new is not None]
            if [new for new, _ in kept] != list(range(len(primitives))):
                raise ValueError('Static primitive remap does not match surviving primitives')
            source_indices = [old for _, old in kept]
    result = []
    for index, (primitive, source_index) in enumerate(zip(primitives, source_indices)):
        material_index = primitive.get('material')
        if type(material_index) is not int or not 0 <= material_index < len(materials) or material_index != source_index:
            raise ValueError('Static primitive material differs from its original native section index')
        primitive.setdefault('extras', {})['nativeSectionIndex'] = source_index
        result.append({'mesh': 0, 'primitive': index, 'gltfMaterial': material_index, 'nativeSectionIndex': source_index})
    return result


def sha(data):
    return hashlib.sha256(data).hexdigest()


def hash_file(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def archive_bytes(manifest, files):
    if len(files) + 1 > 256:
        raise ValueError('Package exceeds 256 files')
    names = ['asset.json'] + list(files)
    if len({name.casefold() for name in names}) != len(names):
        raise ValueError('Duplicate package path')
    for name, payload in files.items():
        safe_name(name)
        if len(payload) > MAX_PAYLOAD:
            raise ValueError(f'Payload exceeds 96 MiB: {name}')
    listed = {entry['path']: entry for entry in manifest['files']}
    if set(listed) != set(files):
        raise ValueError('Manifest does not list exactly the package payloads')
    for name, payload in files.items():
        if listed[name]['sha256'] != sha(payload) or listed[name]['bytes'] != len(payload):
            raise ValueError('Manifest payload hash/length mismatch')
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w', compression=zipfile.ZIP_STORED, allowZip64=False) as archive:
        for name, payload in [('asset.json', json_bytes(manifest))] + sorted(files.items()):
            info = zipfile.ZipInfo(safe_name(name), (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, payload)
    payload = result.getvalue()
    if len(payload) > MAX_ARCHIVE:
        raise ValueError('Package exceeds 128 MiB')
    return payload


def verify_archive(path):
    data = Path(path).read_bytes()
    if len(data) > MAX_ARCHIVE:
        raise ValueError('Package exceeds 128 MiB')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > 256 or any(item.compress_type != zipfile.ZIP_STORED or item.flag_bits & 1 or item.file_size > MAX_PAYLOAD for item in entries):
            raise ValueError('Unsupported archive flags, compression, or size')
        names = [safe_name(item.filename) for item in entries]
        if len({name.casefold() for name in names}) != len(names):
            raise ValueError('Duplicate archive name')
        manifest = require_supported_asset_manifest(json.loads(archive.read('asset.json')))
        if set(names) != {'asset.json', *(item['path'] for item in manifest['files'])}:
            raise ValueError('Archive differs from manifest file table')
        for item in manifest['files']:
            payload = archive.read(item['path'])
            if len(payload) != item['bytes'] or sha(payload) != item['sha256']:
                raise ValueError(f'Corrupt payload: {item["path"]}')
    return {'file': str(path), 'sha256': sha(data), 'bytes': len(data), 'kind': manifest['kind'], 'id': manifest['id'], 'files': len(entries)}


def require_unique_umodel_leaf_name(package, selected):
    same_leaf_exports = [item for item in package.exports if item['name'].casefold() == selected['name'].casefold() and item['className'] == selected['className']]
    if len(same_leaf_exports) != 1:
        raise ValueError('UModel cannot safely select this duplicate leaf name')


def implementation_hash():
    scripts = Path(__file__).parent
    paths = [Path(__file__), scripts / 'native_audio.py', scripts / 'native_animation_families.py', scripts / 'native_effect_bundle.py', *(scripts / 'native_catalog').glob('*.py'), *(scripts / 'native_catalog').glob('*.ps1'), *(scripts / 'native_assets_lib').glob('*.py')]
    return sha(json_bytes({path.relative_to(scripts).as_posix(): hash_file(path) for path in sorted(paths)}))


class Converter:
    def __init__(self, client, output, umodel):
        self.client, self.output, self.umodel = Path(client).resolve(), Path(output).resolve(), Path(umodel).resolve()
        self.reference_client = require_reference_client(self.client)
        if self.output.is_relative_to(self.client):
            raise ValueError('Output must be outside the read-only source client')
        if hash_file(self.umodel) != UMODEL_SHA256:
            raise ValueError('UModel hash differs from the reviewed build1590; refuse unpinned conversion')
        self.output.mkdir(parents=True, exist_ok=True)
        self.package_files_by_casefolded_stem = index_package_files_by_casefolded_stem(self.client)
        self.dependencies = {}
        self.lock_equal_import_closures = set()
        self.logs = []
        self.table_cache = {}
        self.package_cache = {}
        self.class_cache = {}

    def source(self, path):
        path = Path(path).resolve()
        if not path.is_relative_to(self.client) or not path.is_file():
            raise ValueError(f'Source is outside client or missing: {path}')
        relative = path.relative_to(self.client).as_posix()
        self.reference_client.require_equal_file(relative)
        digest = hash_file(path)
        if relative in self.dependencies and self.dependencies[relative] != digest:
            raise ValueError(f'Source changed during conversion: {relative}')
        self.dependencies[relative] = digest
        return path

    def require_unchanged_dependencies(self):
        for name, digest in self.dependencies.items():
            if hash_file(self.client / name) != digest:
                raise ValueError(f'Source changed during conversion: {name}')

    def package(self, name):
        path = self.source(resolve_package_path(self.client, self.package_files_by_casefolded_stem, name))
        key = path.relative_to(self.client).as_posix()
        cached = self.package_cache.get(key)
        if cached is None or cached.source_hash != self.dependencies[key]:
            cached = Package(path.read_bytes(), path.name)
            self.package_cache[key] = cached
        return path, cached

    def select(self, package, name, class_name=None):
        prefix = package.package_name + '.'
        matches = [item for item in package.exports if item['object'].casefold() == name.casefold()
            and (not class_name or item['className'] == class_name)]
        if name.casefold().startswith(prefix.casefold()) and '.' not in name[len(prefix):]:
            name = name[len(prefix):]
        if not matches:
            matches = [item for item in package.exports if (item['object'].casefold() == name.casefold() or item['name'].casefold() == name.casefold()) and (not class_name or item['className'] == class_name)]
        if len(matches) != 1:
            raise ValueError(f'Object missing or ambiguous: {name} ({class_name})')
        selected = matches[0]
        if selected['className'] != 'Sound':
            require_unique_umodel_leaf_name(package, selected)
        return selected

    def require_lock_equal_umodel_reads(self, package_path):
        root_package_name = Path(package_path).resolve().relative_to(self.client).as_posix()
        if root_package_name.casefold() not in self.lock_equal_import_closures:
            require_lock_equal_import_closure(root_package_name, self.package)
            self.lock_equal_import_closures.add(root_package_name.casefold())

    def run(self, work, package_path, item, operation='export'):
        self.require_lock_equal_umodel_reads(package_path)
        arguments = [str(self.umodel), '-' + operation, '-game=l2', '-path=' + str(self.client), '-out=' + str(work / 'export')]
        if operation == 'export':
            arguments += ['-groups', '-gltf', '-png', '-sounds']
        arguments += [str(package_path), item['name'], item['className']]
        result = subprocess.run(arguments, cwd=work, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=300, check=False)
        log = result.stdout.decode('utf-8', errors='replace')
        log_name = f'{len(self.logs):03d}-{operation}-{item["name"]}.log'
        (work / log_name).write_text(log, encoding='utf-8')
        self.logs.append(log_name)
        for relative in re.findall(r'Loading package: (.+?) Ver:', log):
            self.source(self.client / relative)
        if result.returncode or re.search(r'^ERROR:', log, re.MULTILINE):
            raise ValueError(f'UModel failed or reported an error; inspect {work / log_name}')
        return log

    def exported(self, work, item, suffixes):
        matches = [path for path in (work / 'export').rglob('*') if path.is_file() and path.stem == item['name'] and path.suffix.lower() in suffixes]
        if len(matches) != 1:
            raise ValueError(f'Expected exactly one exported payload for {item["object"]}: {matches}')
        return matches[0]

    def texture(self, work, reference):
        package_name = reference.split('.')[0]
        path, package = self.package(package_name)
        item = self.select(package, reference, 'Texture')
        self.run(work, path, item)
        payload = self.exported(work, item, ('.png',)).read_bytes()
        if not payload.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('Texture exporter did not produce PNG')
        properties, _ = package.properties(item)
        return payload, {prop['name']: prop.get('value', {'rawHex': prop['payloadHex']}) for prop in properties}, item['object']

    def material_texture(self, work, reference, visited=None):
        visited = set() if visited is None else visited
        path, package = self.package(reference.split('.')[0])
        item = self.select(package, reference)
        if item['object'] in visited or len(visited) > 16:
            raise ValueError('Cyclic or excessive native material graph')
        visited.add(item['object'])
        if item['className'] == 'Texture':
            payload, properties, qualified = self.texture(work, item['object'])
            return payload, properties, qualified, []
        if item['className'] not in ('Shader', 'FinalBlend'):
            raise ValueError(f'No diffuse material adapter for {item["className"]}: {item["object"]}')
        records, reader = package.properties(item)
        properties = {entry['name']: entry.get('value', {'rawHex': entry['payloadHex']}) for entry in records}
        link = properties.get('Diffuse' if item['className'] == 'Shader' else 'Material')
        if not isinstance(link, dict) or not link.get('object'):
            raise ValueError(f'Native material has no explicit diffuse/material reference: {item["object"]}')
        payload, texture_properties, qualified, graph = self.material_texture(work, link['object'], visited)
        graph.insert(0, {'object': item['object'], 'class': item['className'], 'properties': records, 'trailingHex': reader.take(reader.end - reader.position).hex()})
        return payload, texture_properties, qualified, graph

    def sound(self, work, package, item):
        _, reader = package.properties(item)
        format_name = package.name(reader.compact())
        end = reader.number('i')
        count = reader.count(MAX_PAYLOAD)
        payload = reader.take(count)
        if reader.position != reader.end or end != reader.end:
            raise ValueError('Native Sound lazy-array boundaries do not match export')
        path = work / ('sound-' + item['object'] + ('.ogg' if format_name.casefold() == 'ogg' else '.wav'))
        path.write_bytes(payload)
        decoded, mime, metadata = decode_native_audio(path)
        metadata.update(nativeFormat=format_name, nativePayloadSha256=sha(payload), nativeExportIndex=item['exportIndex'])
        return decoded, mime, metadata

    def materials(self, work, package, document, dump, overrides, binding_provenance=None, native_materials=None):
        slots, limitations = [], []
        materials = document.data.get('materials', [])
        lod0_section_materials = []
        for match in re.finditer(r'Sections\[(\d+)\]\s*=\s*\{\s*Material\s*=\s*([^,}\r\n]+)', dump):
            section = int(match[1])
            if section < len(lod0_section_materials):
                break
            if section != len(lod0_section_materials):
                raise ValueError('Native LOD0 material section order is incomplete')
            lod0_section_materials.append(match[2])
        for index, material in enumerate(materials):
            original = lod0_section_materials[index].strip() if index < len(lod0_section_materials) else 'unavailable'
            reference, provenance = overrides.get(index), binding_provenance or 'explicit-recipe-override'
            native_slot = None
            if native_materials is not None:
                native_slot = native_materials['slots'][index] if index < len(native_materials['slots']) else None
                if native_slot is not None and native_slot['slot'] != index:
                    raise ValueError('Native static material array order changed')
                if not reference:
                    reference = native_slot['sourceReference'] if native_slot else None
                    provenance = 'native-static-material-object-index'
            elif not reference and re.match(r"(?:Texture|Shader|FinalBlend)'", original):
                class_name, short = original.split("'", 1)
                short = short[:-1]
                refs = [entry['object'] for entry in [*package.imports, *package.exports] if entry['className'] == class_name and (entry['object'] == short or entry['object'].endswith('.' + short))]
                if len(set(refs)) != 1:
                    raise ValueError(f'Native material reference is missing or ambiguous: {original}')
                reference, provenance = refs[0], 'native-section-reference'
            slot = {'slot': index, 'sourceMaterial': original, 'binding': provenance if reference else 'unbound-source-slot'}
            if native_materials is not None:
                slot.update(nativeSectionIndex=index, nativeMaterialSlot=native_slot,
                            nativeReferenceStatus=native_slot['referenceStatus'] if native_slot else 'outside-native-material-array')
            if reference:
                payload, properties, qualified, graph = self.material_texture(work, reference)
                texture = document.image(payload, 'image/png', qualified)
                material.clear()
                material.update(name=qualified, pbrMetallicRoughness={'baseColorTexture': {'index': texture}, 'metallicFactor': 0, 'roughnessFactor': 1}, extras={'nativeProperties': properties, 'binding': provenance})
                if properties.get('bMasked') is True:
                    material.update(alphaMode='MASK', alphaCutoff=.5)
                if properties.get('bTwoSided') is True:
                    material['doubleSided'] = True
                for node in reversed(graph):
                    authored = {entry['name']: entry.get('value') for entry in node['properties']}
                    if authored.get('TwoSided') is True:
                        material['doubleSided'] = True
                    if authored.get('AlphaTest') is True and 'AlphaRef' in authored:
                        material.update(alphaMode='MASK', alphaCutoff=authored['AlphaRef'] / 255)
                    limitations.append(f'Material slot {index} {node["object"]}: diffuse/alpha/two-sided preview only; native {node["class"]} blending, specular and environment mapping remain authored metadata.')
                if properties.get('bAlphaTexture') is True:
                    limitations.append(f'Material slot {index} has bAlphaTexture; native blend/shader behavior is not recovered.')
                slot.update(texture=qualified, textureSha256=sha(payload), properties=properties, sourceReference=reference, nativeMaterialGraph=graph)
            else:
                material.clear()
                material.update(name=f'UNBOUND_SOURCE_SLOT_{index}', pbrMetallicRoughness={'baseColorFactor': [1, 0, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 1}, extras={'unboundSourceMaterial': original})
                limitations.append(f'Material slot {index}: {original}. Magenta diagnostic preview; native skin assignment has not been resolved.')
            if native_materials is not None:
                material.setdefault('extras', {}).update(nativeSectionIndex=index,
                    nativeSourceReference=native_slot['sourceReference'] if native_slot else None,
                    nativeSlotProperties=native_slot['properties'] if native_slot else {})
            slots.append(slot)
        if any(index >= len(materials) or index < 0 for index in overrides):
            raise ValueError('Material override refers to a missing slot')
        limitations.append('Native fixed-function/Shader/FinalBlend lighting is not reproduced by glTF metallic-roughness materials.')
        return slots, limitations

    def model_part(self, work, request, package, item, source_path, extra_files=None, extra_mime=None):
        export_log = self.run(work, source_path, item)
        dump = self.run(work, source_path, item, 'dump')
        document = Document(self.exported(work, item, ('.gltf',)))
        weight_report, weight_source = (restore_native_weights(document, package, item)
            if item['className'] == 'SkeletalMesh' else (None, None))
        overrides = {}
        for value in request.get('materials', []):
            slot, reference = value.split('=', 1)
            if int(slot) in overrides:
                raise ValueError('Duplicate material override')
            overrides[int(slot)] = reference
        evidence = self.verify_binding(request) if request.get('sourceBinding') else None
        static_materials = native_static_materials(package, item) if item['className'] == 'StaticMesh' else None
        section_bindings = static_section_bindings(document) if static_materials is not None else None
        graph_summary = None
        if request.get('materialPolicy'):
            from native_assets_lib.material_graph import POLICY, preserve_material_graph
            if (request['materialPolicy'] != POLICY or request['object'] != item['object'] or
                    static_materials is None or overrides or request.get('parts') or extra_files is None or extra_mime is None):
                raise ValueError('Raw material policy requires an exact StaticMesh request without material overrides or assembly')
            slots, limitations, graph_summary, products = preserve_material_graph(self, work, document, item, static_materials)
            if products.keys() & extra_files.keys():
                raise ValueError('Native material graph products overlap existing archive files')
            extra_files.update(products)
            extra_mime.update({name: 'application/json' if name.endswith('.json') else
                'image/png' if name.endswith('.png') else 'image/vnd-ms.dds' if name.endswith('.dds') else 'application/octet-stream'
                for name in products})
        else:
            slots, limitations = self.materials(work, package, document, dump, overrides,
                'native-table-selection' if evidence else None, native_materials=static_materials)
        metadata = {'sourceObject': item['object'], 'sourceSha256': package.source_hash, 'materialSlots': slots, 'originalExportBuffers': list(document.original_buffers), 'gltfMetadataRepairs': list(document.repairs), 'sourceClass': item['className']}
        if static_materials is not None:
            metadata['nativeStaticMaterials'] = static_materials
            metadata['staticSectionBindings'] = section_bindings
        if graph_summary is not None:
            metadata['nativeMaterialGraph'] = graph_summary
        diagnostics = list(dict.fromkeys(line.strip() for line in export_log.splitlines()
            if re.match(r'\s*(?:WARNING:|Renormalized bone weights)', line)))
        metadata['exporterDiagnostics'] = diagnostics
        if weight_report:
            metadata['nativeWeights'] = {**weight_report, 'indexSpace': 'source-part-before-assembly'}
            limitations.extend(weight_report['limits'])
            attachments = weight_source['attachments']
            metadata['nativeAttachmentSource'] = {
                'manifest': 'native-weights-source.json', 'sourceObject': item['object'],
                'entryCount': len(attachments['entries']), 'runtimeInterpretation': 'unverified',
            }
            if attachments['entries']:
                limitations.append('Original skeletal attachment aliases, bone names and FCoords are retained in the source sidecar; native actor weapon attachment composition remains unverified.')
        for message in diagnostics:
            if message.startswith('Renormalized bone weights'):
                limitations.append(f'{item["object"]}: initial UModel export reports "{message}". The source-float restoration and native custom attributes are recorded separately; original exporter buffers remain unchanged for audit.')
        if diagnostics:
            limitations.append('Exporter diagnostics are retained in provenance. Unknown-class messages can refer to loaded package dependencies; they do not establish complete native runtime support.')
        if evidence:
            metadata['sourceBinding'] = evidence
        animation_report, events = None, []
        if item['className'] == 'SkeletalMesh':
            metadata['nativeMeshTransform'] = apply_native_mesh_transform(document, dump)
            if request.get('animation'):
                animation = self.select(package, request['animation'], 'MeshAnimation')
                animation_report = add_animations(document, package, animation)
                limitations.extend(animation_report['limitations'])
                events = [event for event in package.notification_sidecar()['animationEvents'] if event['animationSet'] == animation['object']]
                metadata['animationClips'] = len(animation_report['clips'])
                limitations.append('Native notification properties and qualified sound references are retained; conditional native code, effects, and actor gameplay are not executed.')
            else:
                limitations.append('No native animation set requested; model contains the bind pose only.')
            limitations.append('Native mesh origin/scale/rotation are applied in a dedicated parent. Runtime actor/class DrawScale and equipment composition are not inferred.')
            if request.get('rigidAttachment'):
                attachment_evidence = self.verify_actor_attachment(work, request) if request['rigidAttachment'].get('source') else {'binding': 'explicit-recipe-attachment'}
                metadata['rigidAttachment'] = attach_rigid_part(document, request['rigidAttachment']['bone'])
                metadata['rigidAttachment']['sourceEvidence'] = attachment_evidence
                limitations.extend(metadata['rigidAttachment']['limitations'])
            elif is_root_rigid(document):
                if request.get('parts'):
                    raise ValueError(f'{item["object"]} is a rigid root-bound part; assembly requires an explicit actor-bone rigidAttachment')
                limitations.append('This is a rigid root-bound native part. Actor-level face/hair attachment is unresolved; do not treat its standalone root animation as correct assembled deformation.')
        return document, metadata, limitations, animation_report, events, weight_source

    def verify_actor_attachment(self, work, request):
        from native_catalog.effects import read_class_defaults
        attachment = request['rigidAttachment']
        evidence = attachment['source']
        reference = evidence['class']
        source_path, _ = self.package(reference.split('.')[0])
        if hash_file(source_path) != evidence['packageSha256']:
            raise ValueError('Rigid attachment class package differs from the cited native source')
        if reference not in self.class_cache:
            self.class_cache[reference] = read_class_defaults(self.client, reference, work / 'actor-defaults')
        definition = self.class_cache[reference]
        def value(path):
            result = definition['properties']
            for key in path:
                result = result[key]
            return result
        bone = value(evidence['bonePath'])
        mesh = value(evidence['meshPath'])
        requested_mesh = request['object'] if '.' in request['object'] else request['package'] + '.' + request['object']
        if bone != attachment['bone'] or not isinstance(mesh, dict) or mesh.get('class') != 'SkeletalMesh' or mesh.get('object') != requested_mesh:
            raise ValueError('Rigid attachment bone/mesh differs from the cited native actor defaults')
        return {'class': reference, 'source': definition['source'], 'sourceScriptSha256': definition['sourceScriptSha256'],
            'uelibSha256': definition['uelibSha256'], 'helperSha256': definition['helperSha256'],
            'bonePath': evidence['bonePath'], 'bone': bone, 'meshPath': evidence['meshPath'], 'mesh': mesh,
            'nativeFaceRotation': definition['properties'].get('bFaceRotation'),
            'limitations': definition['limitations']}

    def animation_family_source(self, work, binding, files, mime, clip_names):
        from native_animation_families import build_animation_families, decode_localization111, resolve_animation_references
        from native_catalog.effects import read_class_defaults
        source_path = self.source(self.client / binding['file'])
        if hash_file(source_path) != binding['sha256']:
            raise ValueError('Animation-family localization differs from its source pin')
        class_path, _ = self.package(binding['class'].split('.')[0])
        if hash_file(class_path) != binding['classPackageSha256']:
            raise ValueError('Animation-family class differs from its source pin')
        evidence = work / 'animation-families'
        definition = read_class_defaults(self.client, binding['class'], evidence)
        script = (evidence / safe_name(definition['sourceScript'])).read_bytes()
        encoded = source_path.read_bytes()
        family = build_animation_families(encoded, source={
            'host': binding['sourceHost'], 'path': binding['sourcePath'], 'sha256': binding['sha256']},
            section=binding['section'], class_defaults=definition, class_script_bytes=script)
        family['clipResolution'] = resolve_animation_references(family, clip_names)
        products = {'animation-families.json': json_bytes(family),
                    'animation-families/native.int': encoded,
                    'animation-families/decoded.int': decode_localization111(encoded),
                    'animation-families/class-source/' + safe_name(definition['sourceScript']): script,
                    'animation-families/class-source/defaults.json': json_bytes(definition)}
        if products.keys() & files.keys():
            raise ValueError('Animation-family source products overlap asset payloads')
        files.update(products)
        mime.update({name: 'application/json' if name.endswith('.json') else 'application/octet-stream' for name in products})
        return family

    def verify_binding(self, request):
        from native_catalog.tables import decode_table
        binding = request['sourceBinding']
        name = binding['table']
        path = self.source(self.client / 'system' / (name + '.dat'))
        if hash_file(path) != binding['sourceSha256']:
            raise ValueError('Recipe table hash does not match this native client')
        if name not in self.table_cache:
            self.table_cache[name] = decode_table(self.client, name)
        table = self.table_cache[name]
        def value(path):
            result = table['data']
            for key in path:
                result = result[key]
            return result
        mesh, texture = value(binding['meshPath']), value(binding['texturePath'])
        mesh_reference = request['object'] if '.' in request['object'] else request['package'] + '.' + request['object']
        material = str(binding.get('slot', 0)) + '=' + texture
        if mesh_reference.casefold() != mesh.casefold() or material.casefold() not in [entry.casefold() for entry in request.get('materials', [])]:
            raise ValueError('Recipe mesh/texture binding differs from its cited native table fields')
        return {**binding, 'meshReference': mesh, 'textureReference': texture, 'schema': table['schema'], 'decodedSha256': table['decodedSha256']}

    def event_audio(self, work, events, files, mime):
        resolved = {}
        for reference in sorted({event['sound'] for event in events if event.get('sound')}):
            path, package = self.package(reference.split('.')[0])
            item = self.select(package, reference, 'Sound')
            payload, media_mime, audio_metadata = self.sound(work, package, item)
            name = 'audio/' + item['object'] + ('.ogg' if media_mime == 'audio/ogg' else '.wav')
            files[name], mime[name] = payload, media_mime
            resolved[reference] = {'file': name, 'sourceSha256': package.source_hash, 'sourceObject': item['object'], 'audio': audio_metadata}
        for event in events:
            if event.get('sound') in resolved:
                event['resolvedFile'] = resolved[event['sound']]['file']
        return resolved

    def convert(self, request):
        self.dependencies, self.lock_equal_import_closures, self.logs = {}, set(), []
        request = {key: value for key, value in request.items() if value is not None}
        if 'materialPolicy' in request:
            from native_assets_lib.material_graph import POLICY
            if request['materialPolicy'] != POLICY or request.get('kind') != 'model' or request.get('parts') or request.get('materials'):
                raise ValueError('Unsupported material policy or material-policy assembly/override')
        format_pins = {}
        bindings = [part['sourceBinding'] for part in request.get('parts', [request]) if part.get('sourceBinding')]
        if bindings:
            from native_catalog.tables import table_definition_pins
            for name in sorted({binding['table'] for binding in bindings}):
                format_pins.update(table_definition_pins(name))
        if request.get('materialPolicy') or request.get('animationFamilyBinding') or any(part.get('rigidAttachment', {}).get('source') for part in request.get('parts', [request])):
            from native_catalog.effects import UELIB, UELIB_SHA256
            if hash_file(UELIB) != UELIB_SHA256:
                raise ValueError('UELib differs from the pinned native class reader')
            format_pins['native-class-reader'] = UELIB_SHA256
        base_key = sha(json_bytes({'request': request, 'implementation': implementation_hash(), 'umodel': UMODEL_SHA256}))
        index = self.output / 'index' / (base_key + '.json')
        if index.exists():
            record = json.loads(index.read_text(encoding='utf-8'))
            valid = all((self.client / name).is_file() and hash_file(self.client / name) == digest for name, digest in record['dependencies'].items())
            target = self.output / record['directory']
            valid = valid and all((target / name).is_file() and hash_file(target / name) == digest for name, digest in record['outputs'].items())
            if valid:
                return {**verify_archive(target / 'asset.l2asset'), 'cacheHit': True}
        work_root = self.output / '.work'
        work_root.mkdir(exist_ok=True)
        work = Path(tempfile.mkdtemp(prefix=base_key[:12] + '-', dir=work_root))
        files, limitations, metadata = {}, [], {}
        mime = {}
        events = []
        try:
            kind = request['kind']
            if request.get('media'):
                source_path = self.source(self.client / request['media'])
                payload, media_mime, metadata = decode_native_audio(source_path)
                primary = 'audio.ogg' if media_mime == 'audio/ogg' else 'audio.wav'
                files[primary], mime[primary] = payload, media_mime
                source = {'edition': 'interlude', 'package': source_path.parent.name, 'object': source_path.relative_to(self.client).as_posix(), 'sha256': hash_file(source_path)}
                identity = source['object']
            else:
                initial_request = request.get('parts', [request])[0]
                source_path, package = self.package(initial_request['package'])
                item = self.select(package, initial_request['object'])
                identity = item['object']
                source = {'edition': 'interlude', 'package': package.package_name, 'object': identity, 'sha256': package.source_hash, 'packageVersion': package.summary['version'], 'licenseeVersion': package.summary['licenseeVersion']}
                allowed = {'model': ('StaticMesh', 'SkeletalMesh'), 'texture': ('Texture',), 'audio': ('Sound',)}[kind]
                if item['className'] not in allowed:
                    raise ValueError(f'{item["className"]} has no {kind} adapter; native effects and scripts are not static meshes')
                if kind == 'model':
                    part_request = {**request, **initial_request}
                    document, metadata, limitations, animation_report, events, weight_source = self.model_part(work, part_request, package, item, source_path, files, mime)
                    weight_sources = [weight_source] if weight_source else []
                    reports = []
                    if animation_report:
                        reports.append(animation_report)
                    if request.get('parts'):
                        if len(request['parts']) > 16:
                            raise ValueError('Assembly exceeds 16 parts')
                        part_metadata = [metadata]
                        for part_index, part in enumerate(request['parts'][1:], 1):
                            part_request = {**request, **part}
                            part_path, part_package = self.package(part['package'])
                            part_item = self.select(part_package, part['object'], 'SkeletalMesh')
                            part_work = work / f'part-{part_index:02d}'
                            part_work.mkdir()
                            part_doc, info, part_limits, report, part_events, part_weights = self.model_part(part_work, part_request, part_package, part_item, part_path)
                            if part_weights:
                                weight_sources.append(part_weights)
                            document.merge(part_doc)
                            part_metadata.append(info)
                            limitations.extend(part_limits)
                            if report:
                                reports.append(report)
                            if part_events and part_events != events:
                                raise ValueError('Assembly parts use different event/animation sets')
                        identity = 'assembly:' + request.get('name', item['object'])
                        source['assembly'] = [info['sourceObject'] for info in part_metadata]
                        metadata = {'parts': part_metadata, 'assemblyName': request.get('name', item['object']), 'animationClips': len(document.data.get('animations', []))}
                        limitations.append('This is an explicit assembly recipe. Runtime armor/skin selection is not inferred from names; every override is recorded in provenance.')
                    if reports:
                        files['animation-source.json'] = json_bytes(reports[0] if len(reports) == 1 else {'parts': reports})
                        mime['animation-source.json'] = 'application/json'
                    if weight_sources:
                        files['native-weights-source.json'] = json_bytes({'parts': weight_sources})
                        mime['native-weights-source.json'] = 'application/json'
                    if request.get('animationFamilyBinding'):
                        family = self.animation_family_source(work, request['animationFamilyBinding'], files, mime,
                            [clip['name'] for clip in document.data.get('animations', [])])
                        metadata['nativeAnimationFamilies'] = {
                            'manifest': 'animation-families.json', 'section': family['section'],
                            'classEvidence': 'animation-families/class-source/defaults.json',
                            'originalLocalization': 'animation-families/native.int',
                            'decodedLocalization': 'animation-families/decoded.int',
                            'records': len(family['records']), 'baseClassGetters': len(family['baseClassGetters']),
                            'clipResolutionCounts': family['clipResolution']['counts'],
                            'unverifiedSelectionKeys': family['unverifiedSelectionKeys'],
                        }
                        limitations.extend(family['limitations'])
                    if request.get('withEventAudio'):
                        metadata['eventAudio'] = self.event_audio(work, events, files, mime)
                    limitations = list(dict.fromkeys(limitations + request.get('limitations', [])))
                    primary = 'model.glb'
                    files[primary], mime[primary] = document.glb(), 'model/gltf-binary'
                elif kind == 'texture':
                    self.run(work, source_path, item)
                    primary = 'texture.png'
                    files[primary] = self.exported(work, item, ('.png',)).read_bytes()
                    mime[primary] = 'image/png'
                    properties, _ = package.properties(item)
                    metadata['nativeProperties'] = properties
                    limitations.append('Texture mip0 decoded by pinned UModel; native material/shader behavior is not included.')
                    try:
                        native_texture, native_files = build_texture_source(package, item)
                        if native_texture['format']['propertyStatus'] == 'omitted-native-zero-default':
                            _, defaults = self.package('Engine')
                            expected = native_texture['layout']['evidence']['omittedFormat']['enginePackageSha256']
                            if defaults.source_hash != expected:
                                raise ValueError('Omitted native texture Format requires the reviewed Engine class-default pin')
                        if files.keys() & native_files.keys():
                            raise ValueError('Native texture sidecars overlap existing asset payloads')
                        files.update(native_files)
                        mime.update({name: 'application/json' if name.endswith('.json') else 'application/octet-stream' for name in native_files})
                        metadata['nativeTextureSource'] = {
                            'status': 'preserved', 'manifest': 'native-texture-source.json',
                            'mipCount': native_texture['mipCount'], 'nativeMipBytes': native_texture['nativeMipBytes'],
                            'format': native_texture['format'], 'completeTo1x1': native_texture['completeTo1x1'],
                            'mipsGenerated': False, 'colorOrAlphaModified': False,
                        }
                        limitations.append('Original native mip/palette bytes are separate source data; the PNG preview still uses mip0. Native GPU sampling/blending is not reproduced.')
                        try:
                            derivative, derivative_files = build_texture_dds(native_texture, native_files)
                            if files.keys() & derivative_files.keys():
                                raise ValueError('Compressed texture derivative overlaps existing asset payloads')
                            files.update(derivative_files)
                            mime.update({name: 'application/json' if name.endswith('.json') else 'image/vnd-ms.dds' for name in derivative_files})
                            metadata['nativeTextureDDS'] = {
                                'status': 'available', 'manifest': 'native-texture-dds.json',
                                'file': derivative['file'], 'sha256': derivative['sha256'],
                                'mipCount': derivative['mipCount'], 'completeTo1x1': derivative['completeTo1x1'],
                                'consumer': derivative['consumer'],
                            }
                            limitations.extend(derivative['limitations'])
                        except UnsupportedTextureDDS as error:
                            metadata['nativeTextureDDS'] = {'status': 'unsupported', 'reason': str(error)}
                            limitations.append('Compressed texture derivative unsupported: ' + str(error))
                    except UnsupportedTextureSource as error:
                        metadata['nativeTextureSource'] = {'status': 'unsupported', 'reason': str(error)}
                        metadata['nativeTextureDDS'] = {'status': 'unsupported', 'reason': 'Native texture source sidecar is unavailable: ' + str(error)}
                        limitations.append('Original native mip sidecar unsupported: ' + str(error))
                else:
                    payload, media_mime, metadata = self.sound(work, package, item)
                    primary = 'audio.ogg' if media_mime == 'audio/ogg' else 'audio.wav'
                    files[primary], mime[primary] = payload, media_mime
            converted_source_path = source_path_record(socket.gethostname().upper(), source_path.resolve().as_posix())
            provenance = {'schemaVersion': 1, 'request': request, 'source': {**source, 'path': converted_source_path}, 'dependencies': self.dependencies, 'converterSha256': implementation_hash(), 'tool': {'name': 'UEViewer UModel build1590', 'sha256': UMODEL_SHA256}, 'formatDefinitionPins': format_pins, 'metadata': metadata}
            files['provenance.json'], mime['provenance.json'] = json_bytes(provenance), 'application/json'
            model_extras = {}
            if kind == 'model' and metadata.get('nativeMaterialGraph'):
                model_extras['nativeMaterialGraph'] = metadata['nativeMaterialGraph']
            if kind == 'model' and weight_sources:
                model_extras['nativeSkinAdapter'] = 'L2NativeSkinWeights/1'
            manifest = build_asset_manifest(
                identity=identity, kind=kind, source=source, source_path=converted_source_path,
                client_build=reference_client_build(REFERENCE_CLIENT_LOCK_PATH), converter_version=implementation_hash(),
                limitations=limitations, animation_events=events, primary_file=primary,
                coordinates=asset_coordinates_record(SOURCE_TO_GLTF, 100) if kind == 'model' else None, model_extras=model_extras, files=[])
            if kind == 'texture' and metadata.get('nativeTextureDDS', {}).get('status') == 'available':
                derivative_format = derivative['format']
                if (derivative_format not in ('DXT1', 'DXT5') or
                        derivative_format != native_texture['format']['name'] or
                        files[derivative['file']][84:88] != derivative_format.encode('ascii')):
                    raise ValueError('Texture DDS format differs from native source or FourCC')
                manifest['image']['derivatives'] = [{'file': 'texture.dds', 'manifest': 'native-texture-dds.json', 'format': derivative_format}]
            manifest['files'] = [{'path': name, 'sha256': sha(payload), 'bytes': len(payload), 'mime': mime[name]} for name, payload in sorted(files.items())]
            payload = archive_bytes(manifest, files)
            self.require_unchanged_dependencies()
            content_key = sha(payload)
            target = self.output / content_key
            products = {**files, 'asset.json': json_bytes(manifest), 'asset.l2asset': payload}
            if target.exists():
                if any(not (target / name).exists() or hash_file(target / name) != sha(value) for name, value in products.items()):
                    raise ValueError(f'Existing content-addressed output is corrupt: {target}')
            else:
                target.mkdir()
                for name, value in products.items():
                    (target / name).parent.mkdir(parents=True, exist_ok=True)
                    (target / name).write_bytes(value)
                shutil.copytree(work, target / 'evidence')
            record = {'directory': content_key, 'dependencies': self.dependencies, 'outputs': {name: sha(value) for name, value in products.items()}}
            index.parent.mkdir(exist_ok=True)
            index.write_bytes(json_bytes(record))
            return {**verify_archive(target / 'asset.l2asset'), 'cacheHit': False, 'limitations': limitations, 'metadata': metadata}
        except Exception as error:
            (work / 'failure.txt').write_text(str(error), encoding='utf-8')
            raise


def apply_native_mesh_transform(document, dump):
    def vector(label, names):
        match = re.search(r'\b' + label + r' = \{ ([^}]+) \}', dump)
        if not match:
            raise ValueError(f'Missing native mesh transform {label}')
        values = {key: float(value) for key, value in re.findall(r'(\w+)=([-+.\deE]+)', match[1])}
        return [values[name] for name in names]
    origin = vector('MeshOrigin', ('X', 'Y', 'Z'))
    scale = vector('MeshScale', ('X', 'Y', 'Z'))
    yaw, pitch, roll = [value * math.pi / 32768 for value in vector('RotOrigin', ('Yaw', 'Pitch', 'Roll'))]
    sy, cy, sp, cp, sr, cr = math.sin(yaw), math.cos(yaw), math.sin(pitch), math.cos(pitch), math.sin(roll), math.cos(roll)
    columns = [[cp * cy, cp * sy, sp], [sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, -sr * cp], [-cr * sp * cy - sr * sy, -cr * sp * sy + sr * cy, cr * cp]]
    columns = [[value * scale[index] for value in column] for index, column in enumerate(columns)]
    translation = [-sum(columns[column][row] * origin[column] for column in range(3)) for row in range(3)]
    gltf_axis_order = [0, 2, 1]
    matrix = [columns[column][row] for column in gltf_axis_order for row in gltf_axis_order for _ in [0]]
    matrix = [matrix[0], matrix[1], matrix[2], 0, matrix[3], matrix[4], matrix[5], 0, matrix[6], matrix[7], matrix[8], 0, translation[0] * .01, translation[2] * .01, translation[1] * .01, 1]
    scene = document.data['scenes'][document.data.get('scene', 0)]
    parent = len(document.data['nodes'])
    transformed_joint_roots = []
    skinned_mesh_roots_kept_at_scene_root = []
    for root in scene['nodes']:
        node = document.data['nodes'][root]
        if 'skin' in node:
            transformed_joint_roots.extend(node.pop('children', []))
            skinned_mesh_roots_kept_at_scene_root.append(root)
        else:
            transformed_joint_roots.append(root)
    if not transformed_joint_roots:
        raise ValueError('Native skeletal transform has no joint hierarchy')
    document.data['nodes'].append({'name': 'NativeMeshOriginRotationScale', 'children': transformed_joint_roots, 'matrix': matrix})
    scene['nodes'] = skinned_mesh_roots_kept_at_scene_root + [parent]
    return {'MeshOrigin': origin, 'MeshScale': scale, 'RotOrigin': vector('RotOrigin', ('Yaw', 'Pitch', 'Roll')), 'gltfParentMatrix': matrix, 'basis': 'UEViewer SkelMeshInstance::SetMesh and RotatorToAxis; no height normalization'}


def main():
    parser = argparse.ArgumentParser(description=CONVERTER_DESCRIPTION)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('convert', 'batch'):
        command = commands.add_parser(name)
        command.add_argument('--client', default='E:/lineage2-client')
        command.add_argument('--output', default='artifacts/native-assets')
        command.add_argument('--umodel', default=str(UMODEL))
        if name == 'convert':
            command.add_argument('--kind', choices=('model', 'audio', 'texture'), required=True)
            command.add_argument('--package')
            command.add_argument('--object')
            command.add_argument('--animation')
            command.add_argument('--media', help='Relative native music/media path; audio only')
            command.add_argument('--material', action='append', dest='materials', default=[], help='Explicit slot=Package.Group.Texture override, recorded in provenance')
            command.add_argument('--with-event-audio', action='store_true', dest='withEventAudio', help='Export exact direct Sound references from native animation notifications')
        else:
            command.add_argument('recipe', type=Path, help='JSON array of conversion requests')
    verify = commands.add_parser('verify')
    verify.add_argument('archive', type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'verify':
            print(json.dumps(verify_archive(args.archive), indent=2))
            return
        require_reference_client(args.client)
        converter = Converter(args.client, args.output, args.umodel)
        requests = json.loads(args.recipe.read_text(encoding='utf-8')) if args.command == 'batch' else [{key: getattr(args, key) for key in ('kind', 'package', 'object', 'animation', 'media', 'materials', 'withEventAudio')}]
        for request in requests:
            if request.get('media') and request['kind'] != 'audio' or not request.get('media') and not request.get('parts') and not (request.get('package') and request.get('object')):
                raise ValueError('Use --package and --object, or --kind audio --media')
            print(json.dumps(converter.convert(request), indent=2), flush=True)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(f'Conversion failed: {error}', file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
