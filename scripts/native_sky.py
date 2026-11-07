#!/usr/bin/env python3
"""Scoped original 20_20 sky-room source snapshot; no generic reader widening.

This is a frozen source-asset preview, not a native-time or pixel-parity claim.
Original material graphs, source UVs, mip blocks and unresolved dynamics remain
explicit. No native process or live asset staging is performed.
"""
import argparse
import copy
import io
import json
import math
from pathlib import Path
import struct

import PIL
from PIL import Image, DdsImagePlugin
from native_catalog.ue2 import FormatError, Package, Reader, summary, unwrap
from native_map import actor_properties, decode_property
from native_bsp_floor import (ROOT, MAP_SHA, ENGINE_SHA, PackageAdapter, reviewed_reader,
    require, sha, pinned_bytes, f32, cross, difference, dot, write_unchanged_or_new)
from native_assets_lib.gltf import json_bytes
from native_assets_lib.texture_dds import build_texture_dds

SKY_SHA = '9c45f311e9668f745ef983ef2dbdf1b4ea250c30c30e453a66910f6a261e860f'
SKY_ORIGIN = [292.2027587890625, 264403.15625, 24503.01953125]
ROOTS = ('l2_skies.Shaders.SkybackgroundColor', 'l2_skies.Shaders.HazeRing_Final', 'l2_skies.Shaders.Cloud_Final')
TEXTURES = {'WhiteChip': (31, 3, 32, 32, '1eee1acaf47c9385a36af2f329b42d5538b456284d44b24469106a1ce9493f9e'),
    'WhiteRing': (6, 8, 512, 128, '966b44c9994dd70e44e718a6e6f06adc3d72d24ef6029fdaa9bfe7ed1ce2e11b'),
    'WhiteCloud': (27, 8, 1024, 1024, 'c547473dc6c7754b88a47e10e08703d882c1541a8ce51675b4a7a4bfb8118281')}
ROOT_TEXTURES = dict(zip(ROOTS, TEXTURES))
EXPECTED_COLORS = dict(zip(ROOTS, ([206, 150, 0, 255], [149, 228, 255, 255], [151, 192, 255, 255])))
COLOR_CLASS_SHA = '7e87ce06824002142818ec77ef26f9c9873c615a4f82183e7d93a6653c6b384d'
DDS_PLUGIN_SHA = 'eae2016bb3476be917ff549086c18b89d8e911d0f6d3f0900486a90fe2808cac'
IMAGING_SHA = 'c8c519ec72bf75b2945b4fc4afa854af2fca8b970a403134f9ddda3e164d85e9'
LIMITS = ['Frozen authored sky source state; no native visible-pixel parity is established.',
    'Native runtime sky camera projection, parallax, far-plane/depth composition and live zone binding are unobserved.',
    'TexPanner0 PanRate and stored matrix are retained; no invented clock, phase, GetMatrix formula or animation is applied.',
    'Source ColorModifier bytes are UE2 RGBA. Native time-of-day tint updates, sun, moon and lens-flare behavior are not reproduced.',
    'GLB source preview maps stored color/alpha declarations to unlit factors; native Shader/ColorModifier blending and BSP two-sided precedence remain unverified.',
    'Original mip blocks are preserved; PNG is an ordinary BC1/BC3 decode, without alpha/channel repair, recoloring or generated mipmaps.',
    'Sky source snapshot adds no original-audio parity evidence.']


class ExactSkyPackage(Package):
    """One exact UE118/0 table layout; inherited property reader stays bounded.

    Table order agrees with the pinned Elbera reader (12c9656e); packed tags
    and mip end boundaries were independently compared in the source receipt.
    The generic Package and texture_mips version gates are untouched.
    """
    def __init__(self, raw):
        require(sha(raw) == SKY_SHA, 'Only the qualified original l2_skies.utx is supported')
        self.filename, self.package_name, self.source_hash = 'l2_skies.utx', 'l2_skies', SKY_SHA
        self.summary = summary(raw[:128], self.filename)
        require((self.summary['version'], self.summary['licenseeVersion']) == (118, 0), 'Sky package version changed')
        _, self.data = unwrap(raw, self.filename)
        require([self.summary[k] for k in ('nameCount', 'exportCount', 'importCount')] == [172, 110, 11], 'Sky tables changed')
        r = Reader(self.data, self.summary['nameOffset']); self.names = []
        for _ in range(self.summary['nameCount']):
            self.names.append(r.string()); r.number('I')
        r = Reader(self.data, self.summary['importOffset']); self.imports = []
        for _ in range(self.summary['importCount']):
            self.imports.append({'classPackage': self.name(r.compact()), 'className': self.name(r.compact()),
                                 'outerIndex': r.number('i'), 'name': self.name(r.compact())})
        r = Reader(self.data, self.summary['exportOffset']); self.exports = []
        for index in range(self.summary['exportCount']):
            item = {'exportIndex': index+1, 'classIndex': r.compact(), 'superIndex': r.compact(),
                    'outerIndex': r.number('i'), 'name': self.name(r.compact()), 'flags': r.number('I'), 'size': r.compact()}
            item['offset'] = r.compact() if item['size'] else 0
            require(0 <= item['size'] and 0 <= item['offset'] <= item['offset']+item['size'] <= len(self.data), 'Sky export exceeds package')
            self.exports.append(item)
        for item in self.exports:
            item['object'] = self.object_name(item['exportIndex'])
            item['classObject'] = self.object_name(item['classIndex']) or 'Core.Class'
            item['className'] = item['classObject'].rsplit('.', 1)[-1]
        for index, item in enumerate(self.imports, 1): item['object'] = self.object_name(-index)


def unique(tags, name):
    found = [t for t in tags if t['name'] == name]
    require(len(found) == 1, 'Missing/ambiguous sky property: '+name)
    return found[0]


def material_graph(package):
    queue, seen, result = [77, 76, 78], set(), []
    while queue:
        index = queue.pop(0)
        if index in seen: continue
        seen.add(index); item = package.exports[index-1]
        require(item['className'] in ('ColorModifier', 'Shader', 'TexPanner', 'Texture'), 'Unsupported sky material node')
        tags, tail = package.properties(item)
        if item['className'] != 'Texture': require(tail.position == tail.end, 'Sky material has unknown native tail')
        result.append({'source': copy.deepcopy(item), 'sourceExportSha256': sha(package.data[item['offset']:item['offset']+item['size']]),
                       'propertyTags': tags, 'trailingBytes': tail.end-tail.position})
        for tag in tags:
            if tag['type'] == 5 and tag['value']['index']:
                require(tag['value']['index'] > 0, 'External sky material dependency')
                queue.append(tag['value']['index'])
    require(len(result) == 9, 'Sky material dependency census changed')
    return result


def texture_products(package, name):
    reference, format_id, width, height, digest = TEXTURES[name]
    item = package.exports[reference-1]
    require(item['object'] == 'l2_skies.Textures.'+name and item['className'] == 'Texture', 'Texture identity changed')
    tags, r = package.properties(item)
    require(unique(tags, 'Format')['value'] == format_id and
            [unique(tags, k)['value'] for k in ('USize', 'VSize')] == [width, height], 'Texture dimensions/format changed')
    require(r.count(16) == 1, 'Qualified sky texture must retain its one original mip')
    skip = r.number('i'); count = r.count(2*1024*1024); offset = r.position
    require(skip == offset+count, 'Sky lazy-array skip differs from payload boundary')
    blocks = bytes(r.take(count)); dimensions = [r.number('i'), r.number('i')]; bits = [r.number('B'), r.number('B')]
    require(r.position == r.end and dimensions == [width, height] and [1 << b for b in bits] == dimensions,
            'Sky texture native record boundary/dimensions differ')
    require(sha(blocks) == digest, 'Original sky BC blocks changed')
    export = bytes(package.data[item['offset']:item['offset']+item['size']])
    source = {'package': package.filename, 'packageSha256': SKY_SHA, 'object': item['object'],
              'sourceOffset': item['offset'], 'sourceBytes': item['size'], 'sourceExportSha256': sha(export)}
    metadata = {'schemaVersion': 1, 'kind': 'native-texture-source', 'source': source,
        'layout': {'packageVersion': 118, 'licenseeVersion': 0, 'scope': 'exact pinned sky package only'},
        'format': {'id': format_id, 'name': 'DXT1' if format_id == 3 else 'DXT5'},
        'originalExportFile': 'native/texture-export.bin', 'sourceExportFullyConsumed': True,
        'pixelDecodingApplied': False, 'mipsGenerated': False, 'colorOrAlphaModified': False,
        'mipCount': 1, 'nativeMipBytes': len(blocks), 'completeTo1x1': False,
        'mips': [{'level': 0, 'width': width, 'height': height, 'sourceOffset': offset,
                  'sourceBytes': len(blocks), 'file': 'native/mip00.bin', 'sha256': digest}]}
    originals = {'native/texture-export.bin': export, 'native/mip00.bin': blocks,
                 'native-texture-source.json': json_bytes(metadata)}
    dds_metadata, dds_files = build_texture_dds(metadata, originals)
    dds = dds_files['texture.dds']
    require(PIL.__version__ == '12.3.0', 'Use the pinned installed Pillow12.3.0 decoder')
    pinned_bytes(Path(DdsImagePlugin.__file__), DDS_PLUGIN_SHA)
    pinned_bytes(Path(Image.core.__file__), IMAGING_SHA)
    image = Image.open(io.BytesIO(dds)).convert('RGBA')
    require(image.size == (width, height), 'Decoded sky image dimensions differ')
    buffer = io.BytesIO(); image.save(buffer, format='PNG', compress_level=9)
    files = {name+'.png': buffer.getvalue(), name+'.dds': dds, name+'.mip0.bin': blocks,
             name+'.export.bin': export, name+'.native.json': json_bytes(metadata), name+'.dds.json': json_bytes(dds_metadata)}
    receipt = {'sourceReference': item['object'], 'width': width, 'height': height, 'format': metadata['format'],
        'source': source, 'mip': metadata['mips'][0], 'png': {'file': name+'.png', 'sha256': sha(files[name+'.png'])},
        'dds': {'file': name+'.dds', 'sha256': sha(dds)}, 'decodedRgbaSha256': sha(image.tobytes()),
        'decoder': {'pillow': PIL.__version__, 'ddsPluginSha256': sha(Path(DdsImagePlugin.__file__).read_bytes()),
                    'imagingBinarySha256': sha(Path(Image.core.__file__).read_bytes())}}
    return receipt, files


def geometry(map_raw, graph, texture_receipts):
    package = Package(map_raw, '20_20.unr'); adapter = PackageAdapter(package); reader = reviewed_reader()
    export, binding = reader.level_model_binding(adapter); model = reader._read_model(adapter, export, True)
    reader.validate_model(model)
    require(binding['model'] == {'reference': 9184, 'qualified': '20_20.Model798'}, 'Unexpected final model')
    require(model.zones[28][0] == 390, 'Sky zone binding changed')
    sky_actor = package.exports[389]
    require(sky_actor['object'] == '20_20.SkyZoneInfo0' and sky_actor['classObject'] == 'Engine.SkyZoneInfo', 'Sky actor changed')
    tags, _, _, frame_end = actor_properties(package, sky_actor)
    props = [decode_property(package, tag, '20_20.unwrapped') for tag in tags]
    require([unique(props, 'Location')['value'][axis] for axis in 'XYZ'] == SKY_ORIGIN, 'Sky origin changed')
    parts = []
    for root in ROOTS:
        graph_node = next(n for n in graph if n['source']['object'] == root)
        root_tags = graph_node['propertyTags']; color_tag = unique(root_tags, 'Color')
        require(color_tag['structName'] == 'Color', 'Sky tint is not a Color struct')
        rgba = list(bytes.fromhex(color_tag['payloadHex']))  # UE1/2 FColor archive order is RGBA.
        require(rgba == EXPECTED_COLORS[root], 'Authored source tint changed')
        alpha_tags = [t for t in root_tags if t['name'] == 'AlphaBlend']
        alpha = alpha_tags[0]['value'] if alpha_tags else True
        require(unique(root_tags, 'RenderTwoSided')['value'] is False, 'Source material sidedness changed')
        texture = texture_receipts[ROOT_TEXTURES[root]]
        part = {'sourceMaterial': root, 'positions': [], 'normals': [], 'uvs': [], 'indices': [], 'nodeRanges': [],
                'texture': texture, 'authoredColorRGBA': rgba, 'alphaBlend': alpha, 'renderTwoSided': False,
                'alphaSource': 'serialized' if alpha_tags else 'Engine.ColorModifier default '+COLOR_CLASS_SHA}
        for ni, node in enumerate(model.nodes):
            surface = model.surfs[node.i_surf]
            if 28 not in node.i_zone or package.object_name(surface.material).casefold() != root.casefold(): continue
            points = [list(model.points[model.verts[node.i_vert_pool+k][0]]) for k in range(node.num_vertices)]
            require(len(points) >= 3, 'Degenerate sky polygon')
            normal = list(node.plane[:3]); start = len(part['positions'])//3; first_index = len(part['indices'])
            base, u, v = model.points[surface.p_base], model.vectors[surface.v_texture_u], model.vectors[surface.v_texture_v]
            for point in points:
                require(all(math.isfinite(x) for x in point), 'Nonfinite sky point')
                part['positions'].extend(f32(point[i]*.01) for i in (0, 2, 1))
                part['normals'].extend(f32(normal[i]) for i in (0, 2, 1))
                relative = difference(point, base)
                part['uvs'].extend((f32(dot(relative, u)/texture['width']), f32(dot(relative, v)/texture['height'])))
            for index in range(1, len(points)-1):
                require(dot(cross(difference(points[index], points[0]), difference(points[index+1], points[0])), normal) > 0,
                        'Unqualified sky fan winding/degeneracy')
                part['indices'].extend((start, start+index+1, start+index))
            part['nodeRanges'].append({'node': ni, 'surface': node.i_surf, 'vertexStart': start, 'vertexCount': len(points),
                'indexStart': first_index, 'indexCount': len(part['indices'])-first_index, 'nativePositions': points,
                'nativePlane': list(node.plane), 'nativeTextureBase': list(base), 'nativeTextureU': list(u), 'nativeTextureV': list(v),
                'nodeFlags': node.flags, 'surfaceFlags': surface.flags, 'zoneSides': list(node.i_zone),
                'sourceActor': package.object_name(surface.actor), 'renderSection': node.i_section,
                'renderVertexOffset': node.i_vert_offset, 'lightMap': node.i_light_map})
        parts.append(part)
    require([(len(p['nodeRanges']), len(p['positions'])//3, len(p['indices'])//3) for p in parts] == [(5, 20, 10), (47, 158, 64), (1, 4, 2)],
            'Sky node/vertex/triangle counts changed')
    return {'schemaVersion': 1, 'kind': 'native-sky-source-snapshot', 'id': 'interlude:20_20.Model798.SkyZoneInfo0',
        'sourceSkyZone': '20_20.SkyZoneInfo0', 'skyZoneIndex': 28, 'sourceSkyZonePosition': SKY_ORIGIN,
        'rootTranslationMetres': [-SKY_ORIGIN[i]*.01 for i in (0, 2, 1)],
        'coordinateRule': 'positions=sourceXYZ→XZY*0.01; exactly one root translation=-SkyZoneXYZ→XZY*0.01; no pre-subtraction; reverse fan indices once',
        'uvRule': 'stored BSP dot(position-base, textureU/V) divided by original texture dimensions; no panner transform applied',
        'parts': parts, 'materialGraph': graph, 'skyActorProperties': props, 'levelModelBinding': binding,
        'source': {'mapSha256': MAP_SHA, 'skyPackageSha256': SKY_SHA, 'enginePackageSha256': ENGINE_SHA,
            'modelSha256': sha(package.data[export.serial_offset:export.serial_offset+export.serial_size]),
            'modelOffset': export.serial_offset, 'modelBytes': export.serial_size,
            'skyActorOffset': sky_actor['offset'], 'skyActorBytes': sky_actor['size'],
            'skyActorSha256': sha(package.data[sky_actor['offset']:sky_actor['offset']+sky_actor['size']]),
            'skyActorStateFrameBytes': frame_end-sky_actor['offset'],
            'skyActorStateFrameSha256': sha(package.data[sky_actor['offset']:frame_end]),
            'bspReaderSha256': sha(Path(reader.__file__).read_bytes()),
            'skyPackageVersion': [118, 0], 'sourceColorOrder': 'UE1/2 archive RGBA; UEViewer a0bfb468 UnCore.h2474-2490',
            'colorModifierClassScriptSha256': COLOR_CLASS_SHA},
        'unresolvedDynamics': {'TexPanner0': {'authoredPanRate': .0020000000949949026, 'storedMatrix': 'retained in materialGraph propertyTags',
            'applied': False, 'nativeTimePhaseAndGetMatrix': 'unverified'}, 'timeOfDay': 'unverified; no authored-color replacement',
            'sunMoonLensFlare': 'unimplemented; source actor references retained'}, 'limitations': LIMITS}


def glb(snapshot, files):
    binary, views, accessors, meshes, materials, images, textures = bytearray(), [], [], [], [], [], []
    def append(data):
        binary.extend(b'\0'*(-len(binary)%4)); offset = len(binary); binary.extend(data)
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)}); return len(views)-1
    def accessor(values, dimensions, integer=False, bounds=False):
        vi = append(struct.pack('<'+str(len(values))+('I' if integer else 'f'), *values))
        a = {'bufferView': vi, 'componentType': 5125 if integer else 5126, 'count': len(values)//dimensions,
             'type': {1:'SCALAR',2:'VEC2',3:'VEC3'}[dimensions]}
        if bounds: a.update(min=[min(values[j::3]) for j in range(3)], max=[max(values[j::3]) for j in range(3)])
        accessors.append(a); return len(accessors)-1
    for index, part in enumerate(snapshot['parts']):
        attrs = {'POSITION': accessor(part['positions'],3,bounds=True), 'NORMAL': accessor(part['normals'],3), 'TEXCOORD_0': accessor(part['uvs'],2)}
        idx = accessor(part['indices'],1,integer=True)
        images.append({'bufferView': append(files[part['texture']['png']['file']]), 'mimeType': 'image/png'})
        textures.append({'source': index, 'sampler': 0})
        materials.append({'name': part['sourceMaterial'], 'extensions': {'KHR_materials_unlit': {}},
            'pbrMetallicRoughness': {'baseColorTexture': {'index': index}, 'baseColorFactor': [v/255 for v in part['authoredColorRGBA']],
                                   'metallicFactor': 0, 'roughnessFactor': 1},
            'alphaMode': 'BLEND' if part['alphaBlend'] else 'OPAQUE', 'doubleSided': part['renderTwoSided'],
            'extras': {'nativeSourceReference': part['sourceMaterial'], 'sourceSnapshot': True,
                       'nativeBspTwoSidedPrecedence': 'unverified; per-node flags retained in sky.json'}})
        meshes.append({'name': part['sourceMaterial'], 'primitives': [{'attributes': attrs, 'indices': idx, 'material': index}]})
    nodes = [{'name': snapshot['id'], 'translation': snapshot['rootTranslationMetres'], 'children': [1,2,3]}]
    nodes += [{'mesh': i, 'name': part['sourceMaterial']} for i,part in enumerate(snapshot['parts'])]
    document = {'asset': {'version':'2.0','generator':'native_sky.py'}, 'extensionsUsed':['KHR_materials_unlit'],
        'buffers':[{'byteLength':len(binary)}], 'bufferViews':views, 'accessors':accessors,
        'images':images,'textures':textures,'samplers':[{'wrapS':10497,'wrapT':10497}], 'materials':materials,
        'meshes':meshes,'nodes':nodes,'scenes':[{'nodes':[0]}],'scene':0}
    text = json_bytes(document); text += b' '*(-len(text)%4); binary.extend(b'\0'*(-len(binary)%4))
    return struct.pack('<III',0x46546c67,2,28+len(text)+len(binary))+struct.pack('<I4s',len(text),b'JSON')+text+struct.pack('<I4s',len(binary),b'BIN\0')+binary


def build(client):
    client = Path(client)
    map_data = pinned_bytes(client/'maps/20_20.unr', MAP_SHA)
    pinned_bytes(client/'system/Engine.u', ENGINE_SHA)
    sky = ExactSkyPackage(pinned_bytes(client/'textures/l2_skies.utx', SKY_SHA))
    graph = material_graph(sky); receipts, files = {}, {}
    for name in TEXTURES:
        receipts[name], products = texture_products(sky,name); files.update(products)
    snapshot = geometry(map_data, graph, receipts)
    snapshot['source']['converterSha256'] = sha(Path(__file__).read_bytes())
    snapshot['source']['ddsWrapperSha256'] = sha((ROOT/'scripts/native_assets_lib/texture_dds.py').read_bytes())
    files['sky.json'] = json_bytes(snapshot); files['sky.glb'] = bytes(glb(snapshot, files))
    files['manifest.json'] = json_bytes({'schemaVersion':1,'kind':'native-sky-source-bundle','id':snapshot['id'],
        'source':snapshot['source'],'counts':{'nodes':53,'vertices':182,'triangles':76,'materialRoots':3,'textures':3},
        'files':{name:{'bytes':len(data),'sha256':sha(data)} for name,data in files.items()},'limitations':LIMITS})
    return files


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--client',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();target=args.output.resolve()
    require(target.is_relative_to((ROOT/'artifacts').resolve()) and target != (ROOT/'artifacts').resolve(), 'Use a dedicated artifacts scratch output')
    require(not target.is_relative_to(args.client.resolve()), 'Output must not modify native inputs')
    files=build(args.client);status=write_unchanged_or_new(target,files)
    print(json.dumps({'status':status,'output':str(target),'files':{n:sha(d) for n,d in files.items()}},indent=2))


if __name__=='__main__':main()
