"""Append source-qualified TerrainSector247 without changing any geometry bytes.

Preparation writes immutable artifacts only. --stage-runtime explicitly uses
the existing guarded content-addressed staging helpers; Editor work is never
reimported. Qualification concerns retained submitted coordinates, not pixels.
"""
import argparse
import copy
import importlib.util
import json
from pathlib import Path
import struct

from native_assets_lib.gltf import json_bytes

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('terrain_derivation_io', Path(__file__).with_name('derive-native-map-bsp.py'))
io = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(io)
sha, checked, read_json = io.sha, io.checked, io.read_json
BASE = 'e006306d2ab0d47f5c001cdaf8be91e507af9c20abcb8011cfced5aa59f7d540'
BASE_PLAN_SHA = '3334a688429f9c3aa75cb5ca4144e55183320248355f459bf0a7d1a466b0da72'
CHECKPOINT_SHA = '47fb702008f6a0f1312e690fc411d3e084980edf1608266bd3cf9b94130a5a49'
SOURCE_XYZ_SHA = 'daacf96c3166e646c1afa299469c9dad05aaf66c35c4aa7d22f5e6597d7bf270'
CANDIDATE_SHA = '4ca187a537d745b7650327e875423e8cb05ab4a493a07dfcf0600a627009b848'
MAP_SHA = '1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4'
TC0_SHA = '467a709adc535eba0a6320c714398788b837743c803c88b7c0daf4d32f8e8049'
XYZ_SHA = '7d7a2270424597f16452c8e25c496ca4d45e1380dd4ffd11ad948aba9e8b1714'
SECTOR = '20_20.TerrainInfo0.TerrainSector247'
TERRAIN = '20_20.TerrainInfo0'
PATCH_ID = 'interlude:' + SECTOR
MANIFEST, RECEIPT = io.MANIFEST_FILE, io.RECEIPT_FILE
EXTENSION = 'artifacts/native-parity/research/terrain-extension-20261106'
DEFAULT_BASE = 'artifacts/native-parity/research/map-overlap-expansion-20261106/tree-integration/runtime/bundle.json'
DEFAULT_QUALIFICATION = 'artifacts/native-parity/research/terrain-mask-native-rea-followup/continuation-20261106-ongoing/adjacent-terrain-source-join-20261106'
EVIDENCE = {'nativeSubmittedCoordinatesQualified': True, 'nativeVisiblePixelsQualified': False,
            'manifestSha256': CHECKPOINT_SHA, 'sourceXYZSha256': SOURCE_XYZ_SHA}
MASK_STATUS = ('Retained submitted TC0 qualified only for 20_20.TerrainInfo0.TerrainSector247 grid X112..128/Y240..255; '
               'native pixels and material composition unverified.')


def require(value, message):
    if not value:
        raise ValueError(message)


def pin(data):
    return {'sha256': sha(data), 'bytes': len(data)}


def glb_parts(data):
    require(len(data) >= 28 and struct.unpack_from('<III', data) == (0x46546c67, 2, len(data)), 'Invalid terrain GLB header')
    size, kind = struct.unpack_from('<II', data, 12)
    require(kind == 0x4e4f534a and size % 4 == 0 and 28 + size <= len(data), 'Invalid terrain JSON chunk')
    document = read_json(data[20:20 + size])
    bin_size, bin_type = struct.unpack_from('<II', data, 20 + size)
    require(bin_type == 0x004e4942 and bin_size % 4 == 0 and 28 + size + bin_size == len(data), 'Invalid terrain BIN chunk')
    return document, data[28 + size:], data[20 + size:]


def channel(document, binary, name, components):
    primitives = document['meshes'][0]['primitives']
    require(len(primitives) == 1, 'Unexpected terrain primitives')
    accessor = document['accessors'][primitives[0]['attributes'][name]]
    view = document['bufferViews'][accessor['bufferView']]
    require(accessor['componentType'] == 5126 and accessor['count'] == 272 and accessor['type'] == 'VEC' + str(components)
            and not accessor.get('normalized') and 'sparse' not in accessor and view['buffer'] == 0, 'Unexpected terrain channel: ' + name)
    width = components * 4
    stride = view.get('byteStride', width)
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    require(stride >= width and 0 <= start and start + 271 * stride + width <= len(binary), 'Terrain channel outside BIN')
    return [binary[start + index * stride:start + index * stride + width] for index in range(272)]


def read_qualification(root, observations):
    root = io.unlinked(root)
    checkpoint_path = io.local(root, 'CHECKPOINT-MANIFEST.json')
    encoded = checked(checkpoint_path, CHECKPOINT_SHA)
    observations[checkpoint_path] = encoded
    checkpoint = read_json(encoded)
    require(checkpoint['base'] == 'continuation-20261106-ongoing' and len(checkpoint['files']) == 32, 'Native checkpoint scope differs')
    records = {}
    for item in checkpoint['files']:
        require(item['path'] not in records, 'Duplicate native checkpoint path')
        path = io.local(root.parent, item['path'])
        value = checked(path, item['sha256'], item['bytes'])
        observations[path] = value
        records[item['path']] = value
    prefix = root.name + '/'
    rows = read_json(records[prefix + 'QUALIFIED_ROWS.json'])
    joined = read_json(records[prefix + 'SOURCE_JOIN.json'])
    require(joined['status'] == 'PASS_COMPLETE_RETAINED_SOURCE_XYZ_JOIN' and joined['scope']['sourcePoints'] == 272
            and joined['scope']['matchedNativeRecords'] == 323 and joined['tc0Comparison']['sourcePointCorrectedMatches'] == 272,
            'Native source qualification differs')
    require(joined['qualifiedXYZFloat32LE'] == {'bytes': 3264, 'sha256': XYZ_SHA}
            and joined['nativeTC0Float32LE'] == {'bytes': 2176, 'sha256': TC0_SHA}, 'Native coordinate identity differs')
    return rows, joined, {item['path']: {'sha256': item['sha256'], 'bytes': item['bytes']} for item in checkpoint['files']}


def qualified_geometry(candidate, source, rows, joined, provenance):
    require(sha(candidate) == CANDIDATE_SHA, 'Conditional candidate hash differs; no repair or second correction permitted')
    require(source['recordCount'] == 272 and source['sector']['object'] == SECTOR and source['sector']['exportIndex'] == 2516
            and source['sector']['offset'] == [112, 240] and source['sector']['quads'] == [16, 15], 'Source sector differs')
    require(source['terrainActor']['object'] == TERRAIN and source['terrainActor']['exportIndex'] == 9
            and source['inputs'][source['stagedMapPath']]['sha256'] == MAP_SHA, 'Source terrain/map differs')
    require(len(rows) == len(source['records']) == 272, 'Qualified row count differs')
    document, binary, bin_chunk = glb_parts(candidate)
    require(len(document['meshes']) == 1, 'Unexpected terrain mesh count')
    extras = document['meshes'][0]['extras']
    comparison = extras.get('offlineTerrainComparison', {})
    require(extras['nativeObject'] == SECTOR and extras['nativeGridOffset'] == [112, 240] and extras['nativeGridQuads'] == [16, 15]
            and comparison.get('variant') == 'conditional-corrected' and comparison.get('nativeSubmittedCoordinatesQualified') is False
            and 'nativeTerrainCoordinateEvidence' not in extras and len(extras['nativeLayers']) == 9, 'Candidate metadata/scope differs')
    positions, uv = channel(document, binary, 'POSITION', 3), channel(document, binary, 'TEXCOORD_0', 2)
    xyz, tc0, points = bytearray(), bytearray(), []
    record_count = 0
    for index, (native, original) in enumerate(zip(rows, source['records'])):
        grid = [112 + index % 17, 240 + index // 17]
        require(native['row'] == original['patchVertexIndex'] == index and native['grid'] == original['grid'] == grid, 'Source/native row order differs')
        position = bytes.fromhex(original['nativeXYZFloat32LEHex'])
        require(native['sourceXYZFloat32LEHex'] == original['nativeXYZFloat32LEHex'] and native['sourceG16'] == original['height']
                and native['sourceXYZSHA256'] == original['nativeXYZFloat32LESha256'] == sha(position)
                and native['nativeXYZAllBitExact'] is True and native['correctedTC0BitExact'] is True
                and native['nativeRecordCount'] == len(native['nativeVertexIndices']) and native['nativeRecordCount'] >= 1,
                'Qualified native/source XYZ join differs')
        point = struct.unpack('<3f', position)
        require(list(point) == original['nativeXYZFloat32'] == native['sourceXYZFloat32'], 'Source float32 values differ')
        require(positions[index] == struct.pack('<3f', point[0] * .01, point[2] * .01, point[1] * .01), 'Candidate POSITION differs from exact source transform')
        mask = bytes.fromhex(native['nativeTC0Float32LEHex'])
        expected = struct.pack('<2f', (grid[0] + .5) / 256, (grid[1] + .5) / 256 - max(grid[1] - 240, 0) / 4096)
        require(uv[index] == mask == expected and list(struct.unpack('<2f', mask)) == native['nativeTC0Float32'], 'Candidate UV differs from qualified bytes; refuse double correction')
        require(142120 in native['referencingDrawCalls'], 'Missing captured base indexed reference')
        xyz.extend(position); tc0.extend(mask); points.append(point); record_count += native['nativeRecordCount']
    require(record_count == 323 and sha(xyz) == XYZ_SHA and sha(tc0) == TC0_SHA, 'Qualified complete stream differs')
    native_bounds = [min(p[axis] for p in points) for axis in range(3)] + [max(p[axis] for p in points) for axis in range(3)]
    require([[native_bounds[axis], native_bounds[axis + 3]] for axis in range(3)] == joined['qualifiedBoundsNativeXYZ'], 'Joined full-vertex bounds differ')
    require(native_bounds[2] == -3135.255126953125, 'Cached minimum substituted for actual vertices')
    primitive = document['meshes'][0]['primitives'][0]
    require(document['accessors'][primitive['indices']]['count'] == 1440, 'Source triangle count differs')
    updated = copy.deepcopy(document)
    del updated['meshes'][0]['extras']['offlineTerrainComparison']
    updated['meshes'][0]['extras']['nativeTerrainCoordinateEvidence'] = dict(EVIDENCE)
    for layer in updated['meshes'][0]['extras']['nativeLayers']:
        layer['maskUVStatus'] = MASK_STATUS
    encoded = json_bytes(updated).rstrip(b'\n')
    encoded += b' ' * (-len(encoded) % 4)
    qualified = struct.pack('<III', 0x46546c67, 2, 20 + len(encoded) + len(bin_chunk)) + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded + bin_chunk
    checked_document, checked_binary, checked_chunk = glb_parts(qualified)
    require(checked_document == updated and checked_binary == binary and checked_chunk == bin_chunk, 'Qualification changed binary geometry')
    browser_points = [struct.unpack('<3f', row) for row in positions]
    metadata = {'schemaVersion': 1, 'kind': 'native-source-terrain-coordinate-qualified-patch', 'id': PATCH_ID,
                'sourceTerrain': TERRAIN, 'sourceSector': SECTOR, 'sourceMapSha256': MAP_SHA,
                'gridBounds': [112, 240, 128, 255], 'counts': {'vertices': 272, 'quads': 240, 'triangles': 480,
                    'hiddenQuads': 0, 'turnedQuads': 9, 'newPositions': 256, 'sharedPositions': 16, 'nativeRecords': 323},
                'nativeTerrainCoordinateEvidence': dict(EVIDENCE), 'sourceHost': source['sourceHost'],
                'sourceMapPath': source['sourceMapPath'], 'sourceHeightPackagePath': source['sourceHeightPackagePath'],
                'sourceActor': source['terrainActor'], 'heightSource': source['heightSource'],
                'sourceSectorMetadata': source['sector'], 'sourceInputPins': source['inputs'],
                'coordinateBasis': source['coordinateBasis'], 'nativeXYZFloat32LE': pin(xyz), 'nativeTC0Float32LE': pin(tc0),
                'bounds': {'nativeXYZFromAllVertices': native_bounds,
                           'browserXYZFloat32FromAllVertices': [min(p[a] for p in browser_points) for a in range(3)] + [max(p[a] for p in browser_points) for a in range(3)],
                           'cachedNativeXYZNotUsed': source['sector']['bounds']},
                'geometry': {'candidate': pin(candidate), 'qualified': pin(qualified), 'binary': pin(binary),
                             'everyBinaryBytePreserved': True, 'correctionAppliedByDerivation': False,
                             'normalsFloat32Sha256': sha(b''.join(channel(document, binary, 'NORMAL', 3))),
                             'diffuseUV2Float32Sha256': sha(b''.join(channel(document, binary, 'TEXCOORD_1', 2)))},
                'nativeLayers': copy.deepcopy(updated['meshes'][0]['extras']['nativeLayers']), 'qualificationProvenance': provenance,
                'nativeDrawJoins': joined['drawJoins'], 'nativeState': {'stage1Mask': 'TEXCOORD0; transforms DISABLE',
                                                                    'stage0Diffuse': 'CAMERASPACEPOSITION; COUNT2'},
                'limitations': ['Qualified retained offscreen submissions, not visible native pixels or screen improvement.',
                               'No captured runtime actor pointer, generation branch, color/light equation or material-dispatch qualification.',
                               'Stage1 mask coordinate evidence does not disable stage0 diffuse coordinate transforms.',
                               'bUseAlpha, driver precision, final composition and native visibility remain separate unresolved work.',
                               'Original audio remains required for overall parity; no audio evidence or policy is supplied by this geometry derivation.',
                               'All nine original diffuse records and reference normals are retained; their complete native shading parity is not established.']}
    return {'terrain247.glb': qualified, 'terrain247.json': json_bytes(metadata)}


def base_files(plan_path, observations):
    plan_path = io.unlinked(plan_path)
    encoded = checked(plan_path, BASE_PLAN_SHA)
    observations[plan_path] = encoded
    plan = read_json(encoded)
    root = io.local(plan_path.parent, 'bundle')
    require(plan['manifestSha256'] == BASE and len(plan['files']) == 952 and io.file_set(root) == set(plan['files']), 'Current tree bundle scope differs')
    result = {}
    for name, record in plan['files'].items():
        path = io.local(root, name)
        value = checked(path, record['sha256'], record['bytes'])
        observations[path] = value
        result[name] = value
    return result


def derive(files, geometry):
    require(set(geometry) == {'terrain247.glb', 'terrain247.json'}, 'Qualified patch file set differs')
    original, receipt = read_json(files[MANIFEST]), read_json(files[RECEIPT])
    require(sha(files[MANIFEST]) == BASE and receipt['manifestSha256'] == BASE and len(files) == 952
            and len(original['models']) == 62 and len(original['placements']) == 157 and len(original.get('bsp', [])) == 1
            and 'terrainPatches' not in original, 'Base bundle changed or terrain patch already present')
    metadata = read_json(geometry['terrain247.json'])
    require(metadata['id'] == PATCH_ID and metadata['nativeTerrainCoordinateEvidence'] == EVIDENCE
            and metadata['geometry']['qualified'] == pin(geometry['terrain247.glb']), 'Qualified metadata/GLB join differs')
    entry = {'id': PATCH_ID, 'sourceTerrain': TERRAIN, 'sourceSector': SECTOR, 'sourceMapSha256': MAP_SHA,
             'gridBounds': [112, 240, 128, 255], 'model': {'file': 'terrain247.glb', **pin(geometry['terrain247.glb'])},
             'source': {'file': 'terrain247.json', **pin(geometry['terrain247.json'])}}
    updated = copy.deepcopy(original)
    updated['terrainPatches'] = [entry]
    payload = json_bytes(updated); digest = sha(payload)
    receipt['manifestSha256'] = digest
    receipt.setdefault('derivation', {})['terrainPatch'] = {'schemaVersion': 1, 'baseManifestSha256': BASE,
        'sourcePatch': copy.deepcopy(entry), 'nativeTerrainCoordinateEvidence': dict(EVIDENCE), 'existingGeometryUnchanged': True}
    result = dict(files)
    result[MANIFEST], result[RECEIPT] = payload, json_bytes(receipt)
    for name, value in geometry.items():
        require('map-section/' + name not in result, 'Existing patch destination refused')
        result['map-section/' + name] = value
    require({name for name in files if files[name] != result[name]} == {MANIFEST, RECEIPT}, 'Unexpected original bundle change')
    return digest, result


def run(args):
    output, qualified = io.unlinked(args.output), io.unlinked(args.qualified_output)
    inputs = [io.unlinked(args.candidate).parent, io.unlinked(args.source_xyz).parent,
              io.unlinked(args.qualification).parent, io.unlinked(args.base_bundle).parent,
              ROOT / 'artifacts/native-parity/inputs', ROOT / 'artifacts/native-parity/migration']
    for path in (output, qualified):
        require(path.is_relative_to(ROOT / 'artifacts') and path != ROOT / 'artifacts', 'Use dedicated destination artifacts scratch directories')
        io.local(ROOT, path.relative_to(ROOT).as_posix())
        require(not any(path.is_relative_to(source) or source.is_relative_to(path) for source in inputs), 'Output overlaps protected source/evidence input')
    require(not output.is_relative_to(qualified) and not qualified.is_relative_to(output), 'Qualified/runtime outputs overlap')
    observations = {}
    rows, joined, checkpoint_files = read_qualification(args.qualification, observations)
    source_path = io.unlinked(args.source_xyz)
    source_data = checked(source_path, SOURCE_XYZ_SHA); observations[source_path] = source_data
    source = read_json(source_data)
    for name, record in source['inputs'].items():
        path = io.local(ROOT, name)
        observations[path] = checked(path, record['sha256'], record['bytes'])
    candidate_path = io.unlinked(args.candidate)
    candidate = checked(candidate_path, CANDIDATE_SHA); observations[candidate_path] = candidate
    geometry = qualified_geometry(candidate, source, rows, joined,
        {'manifest': str(io.unlinked(args.qualification).relative_to(ROOT) / 'CHECKPOINT-MANIFEST.json').replace('\\', '/'),
         'manifestSha256': CHECKPOINT_SHA, 'payloadPins': checkpoint_files, 'sourceXYZSha256': SOURCE_XYZ_SHA,
         'sourceXYZPath': source_path.relative_to(ROOT).as_posix(), 'candidatePath': candidate_path.relative_to(ROOT).as_posix()})
    files = base_files(args.base_bundle, observations)
    digest, derived = derive(files, geometry)
    plan = {'schemaVersion': 1, 'kind': 'native-map-terrain-patch-derivation', 'baseManifestSha256': BASE,
            'manifestSha256': digest, 'baseBundleSha256': BASE_PLAN_SHA, 'sourceManifestPath': str(Path(args.base_bundle).parent / 'bundle' / MANIFEST),
            'qualificationManifestSha256': CHECKPOINT_SHA, 'sourceXYZSha256': SOURCE_XYZ_SHA, 'addedTerrainPatchIds': [PATCH_ID],
            'unchangedBaseFiles': 950, 'nativeSubmittedCoordinatesQualified': True, 'nativeVisiblePixelsQualified': False,
            'implementation': {Path(__file__).name: sha(Path(__file__).read_bytes()), 'derive-native-map-bsp.py': sha(Path(io.__file__).read_bytes())},
            'files': {name: pin(value) for name, value in sorted(derived.items())}}
    scratch = {'bundle/' + name: value for name, value in derived.items()}
    scratch['bundle.json'] = json_bytes(plan)
    before = after = None
    if args.stage_runtime:
        catalog = io.local(ROOT, 'public/l2/catalog.json'); before = catalog.read_bytes()
        selected = [row for row in read_json(before).get('sections', []) if row['id'] == io.SECTION]
        require(len(selected) == 1 and selected[0]['manifestSha256'] in (BASE, digest), 'Catalog selects newer work; refuse replacement')
        after = io.catalog_replace(before, BASE, digest) if selected[0]['manifestSha256'] == BASE else before
        scratch.update({'catalog.before.json': io.catalog_replace(after, digest, BASE), 'catalog.after.json': after})
        destination = io.local(ROOT, 'public/l2/maps/' + digest); io.preflight(destination, derived)
    io.preflight(qualified, geometry)
    io.preflight(output, scratch, optional=('catalog.before.json', 'catalog.after.json') if not args.stage_runtime else ())
    require(all(path.read_bytes() == value for path, value in observations.items()), 'Derivation input changed during preparation')
    for name, value in geometry.items(): io.immutable_write(io.local(qualified, name), value)
    for name, value in scratch.items(): io.immutable_write(io.local(output, name), value)
    if args.stage_runtime:
        for name, value in derived.items(): io.immutable_write(io.local(destination, name), value)
        io.commit_catalog(catalog, before, after)
    return {'status': 'staged' if args.stage_runtime else 'prepared', 'manifestSha256': digest,
            'baseManifestSha256': BASE, 'files': len(derived), 'unchangedBaseFiles': 950,
            'bundleDescriptor': str(output / 'bundle.json'), 'bundleDescriptorSha256': sha(scratch['bundle.json']),
            'sourceManifestPath': plan['sourceManifestPath'], 'manifestPath': str(output / 'bundle' / MANIFEST),
            'qualifiedGeometry': {name: pin(value) for name, value in geometry.items()},
            'publicChanged': bool(args.stage_runtime and before != after)}


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', type=Path, default=ROOT / EXTENSION / 'sector247-extraction/conditional-corrected/terrain.glb')
    parser.add_argument('--source-xyz', type=Path, default=ROOT / EXTENSION / 'source-audit/candidate-native-xyz.json')
    parser.add_argument('--qualification', type=Path, default=ROOT / DEFAULT_QUALIFICATION)
    parser.add_argument('--base-bundle', type=Path, default=ROOT / DEFAULT_BASE)
    parser.add_argument('--qualified-output', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stage-runtime', action='store_true')
    return parser.parse_args()


if __name__ == '__main__':
    print(json.dumps(run(arguments()), indent=2))
