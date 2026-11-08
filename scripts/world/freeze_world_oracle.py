from pathlib import Path
import posixpath
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import hashlib
import json
import re

from hash_reference_client_tree import canonical_json_bytes as compact_canonical_json_bytes
from native_store.canonical_json import canonical_json_bytes
from world.committed_world_data import REPOSITORY_ROOT, require_committed_destination, write_committed_world_bytes

WORLD_ORACLE_RELATIVE_PATH = 'recipes/world/oracle/20_20/expected.json'
WORLD_ORACLE_SCHEMA_VERSION = 1
DEFAULT_STORE_ROOT = REPOSITORY_ROOT / 'public' / 'l2'
SKY_PIN_SOURCE_PATH = REPOSITORY_ROOT / 'src' / 'scene' / 'world' / 'nativeSkyPresentation.ts'
ENVIRONMENT_PIN_SOURCE_PATH = REPOSITORY_ROOT / 'src' / 'scene' / 'world' / 'nativeEnvironmentTables.ts'
SECTION_RECORD_ID = 'map-20-20-section'
MOVERS_RECORD_ID = 'map-20-20-movers'
STORE_URL_PREFIX = '/l2/'
CATALOG_FILE_NAME = 'catalog.json'
MANIFEST_FILE_NAME = 'manifest.json'
BSP_SOURCE_FOLDER = '../map-section-bsp'
MAXIMUM_JUNCTION_JSON_BYTES = 32 * 1024 * 1024
SHA256_TEXT_PATTERN = re.compile(r'[0-9a-f]{64}')
LONG_ENCODED_RUN_PATTERN = re.compile(r'[A-Za-z0-9+/=]{65,}')
ORACLE_FIELDS = frozenset({'schemaVersion', 'catalogSha256', 'section', 'sky', 'environment', 'movers'})
SECTION_FIELDS = frozenset({'id', 'manifestSha256', 'modelCount', 'placementCount', 'models', 'placements', 'terrain', 'terrainPatches', 'bsp',
                            'unsupportedRuntimeMaterialIds'})
MOVERS_FIELDS = frozenset({'recordId', 'manifestSha256', 'sourceMapSha256', 'terrainSha256', 'moverIds', 'modelIds'})


class WorldOracleError(ValueError):
    pass


def read_bounded_store_bytes(store_root, relative_path):
    store_root = Path(store_root).resolve()
    path = (store_root / relative_path).resolve()
    if not path.is_relative_to(store_root):
        raise WorldOracleError(f'store path escapes the store root: {relative_path}')
    if not path.is_file():
        raise WorldOracleError(f'store file is missing: {relative_path}')
    with open(path, 'rb') as stream:
        payload = stream.read(MAXIMUM_JUNCTION_JSON_BYTES + 1)
    if len(payload) > MAXIMUM_JUNCTION_JSON_BYTES:
        raise WorldOracleError(f'store file exceeds {MAXIMUM_JUNCTION_JSON_BYTES} bytes: {relative_path}')
    return payload


def sha256_hex(payload):
    return hashlib.sha256(payload).hexdigest()


def decode_json_object(payload, relative_path):
    try:
        document = json.loads(payload.decode('utf-8'))
    except ValueError as error:
        raise WorldOracleError(f'store file is not JSON: {relative_path}: {error}') from error
    if not isinstance(document, dict):
        raise WorldOracleError(f'store file is not a JSON object: {relative_path}')
    return document


def read_pinned_json(store_root, relative_path, expected_sha256):
    payload = read_bounded_store_bytes(store_root, relative_path)
    if sha256_hex(payload) != expected_sha256:
        raise WorldOracleError(f'{relative_path} hashes to {sha256_hex(payload)}, not the pinned {expected_sha256}')
    return decode_json_object(payload, relative_path)


def store_relative_path(store_url):
    if not (isinstance(store_url, str) and store_url.startswith(STORE_URL_PREFIX)):
        raise WorldOracleError(f'catalog manifest path must start with {STORE_URL_PREFIX}: {store_url!r}')
    return store_url[len(STORE_URL_PREFIX):]


def catalog_record(catalog, slice_name, record_id):
    records = [record for record in catalog.get(slice_name, []) if isinstance(record, dict) and record.get('id') == record_id]
    if len(records) != 1:
        raise WorldOracleError(f'catalog {slice_name} must hold exactly one {record_id} record, found {len(records)}')
    return records[0]


def typescript_pin(source_path, field_name):
    matches = re.findall(rf'\b{field_name}: "([^"]+)"', Path(source_path).read_text(encoding='utf-8'))
    if len(matches) != 1:
        raise WorldOracleError(f'{Path(source_path).name} must pin {field_name} exactly once, found {len(matches)}')
    return matches[0]


def record_id(record):
    return record['id']


def matrix_canonical_sha256(matrix):
    return sha256_hex(compact_canonical_json_bytes(matrix))


def bsp_oracle_record(store_root, manifest_relative_path, bsp):
    source_relative_path = posixpath.normpath(posixpath.join(posixpath.dirname(manifest_relative_path), BSP_SOURCE_FOLDER, bsp['source']['file']))
    source = read_pinned_json(store_root, source_relative_path, bsp['source']['sha256'])
    indices = source.get('indices')
    if not (isinstance(indices, list) and len(indices) % 3 == 0):
        raise WorldOracleError(f'BSP source {bsp["id"]} indices are not a list of triangles')
    return {'id': bsp['id'], 'sourceModel': bsp['sourceModel'], 'sourceBrush': bsp['sourceBrush'], 'sourceMapSha256': bsp['sourceMapSha256'],
            'modelSha256': bsp['model']['sha256'], 'sourceSha256': bsp['source']['sha256'], 'triangleCount': len(indices) // 3,
            'supportPlacementIds': sorted(bsp['supportPlacementIds'])}


def section_oracle(store_root, catalog):
    record = catalog_record(catalog, 'sections', SECTION_RECORD_ID)
    manifest_relative_path = store_relative_path(record['manifest'])
    manifest = read_pinned_json(store_root, manifest_relative_path, record['manifestSha256'])
    return {
        'id': record['id'],
        'manifestSha256': record['manifestSha256'],
        'modelCount': len(manifest['models']),
        'placementCount': len(manifest['placements']),
        'models': sorted(({'id': model['id'], 'sourceObject': model['sourceObject'], 'archiveSha256': model['archive']['sha256']}
                          for model in manifest['models']), key=record_id),
        'placements': sorted(({'id': placement['id'], 'modelId': placement['modelId'], 'sourceMesh': placement['sourceMesh'],
                               'matrixCanonicalSha256': matrix_canonical_sha256(placement['matrix'])} for placement in manifest['placements']), key=record_id),
        'terrain': {'file': manifest['terrain']['file'], 'sha256': manifest['terrain']['sha256'], 'bytes': manifest['terrain']['bytes']},
        'terrainPatches': sorted(({'id': patch['id'], 'modelSha256': patch['model']['sha256'], 'sourceSha256': patch['source']['sha256']}
                                  for patch in manifest['terrainPatches']), key=record_id),
        'bsp': sorted((bsp_oracle_record(store_root, manifest_relative_path, bsp) for bsp in manifest.get('bsp', [])), key=record_id),
        'unsupportedRuntimeMaterialIds': sorted(gap['modelId'] for gap in manifest.get('unsupportedRuntimeMaterials', [])),
    }


def sky_oracle(store_root):
    manifest_sha256 = typescript_pin(SKY_PIN_SOURCE_PATH, 'manifestSha256')
    source_id = typescript_pin(SKY_PIN_SOURCE_PATH, 'sourceId')
    manifest = read_pinned_json(store_root, f'skies/{manifest_sha256}/{MANIFEST_FILE_NAME}', manifest_sha256)
    if manifest.get('id') != source_id:
        raise WorldOracleError(f'sky manifest id {manifest.get("id")!r} differs from the pinned sourceId {source_id}')
    return {'manifestSha256': manifest_sha256, 'sourceId': source_id,
            'files': [{'path': path, 'sha256': manifest['files'][path]['sha256'], 'bytes': manifest['files'][path]['bytes']}
                      for path in sorted(manifest['files'])]}


def environment_oracle(store_root):
    conversion_manifest_sha256 = typescript_pin(ENVIRONMENT_PIN_SOURCE_PATH, 'conversionManifestSha256')
    folder = f'environments/{conversion_manifest_sha256}'
    manifest_payload = read_bounded_store_bytes(store_root, f'{folder}/{MANIFEST_FILE_NAME}')
    manifest = decode_json_object(manifest_payload, f'{folder}/{MANIFEST_FILE_NAME}')
    listed_files = [manifest['conversionManifest'], manifest['tables']]
    if manifest['conversionManifest']['sha256'] != conversion_manifest_sha256:
        raise WorldOracleError(f'environment manifest lists conversion manifest {manifest["conversionManifest"]["sha256"]}, '
                               f'not the pinned {conversion_manifest_sha256}')
    read_pinned_json(store_root, f'{folder}/{manifest["conversionManifest"]["file"]}', conversion_manifest_sha256)
    files = [{'path': MANIFEST_FILE_NAME, 'sha256': sha256_hex(manifest_payload), 'bytes': len(manifest_payload)}]
    files.extend({'path': listed['file'], 'sha256': listed['sha256'], 'bytes': listed['bytes']} for listed in listed_files)
    return {'manifestSha256': conversion_manifest_sha256, 'files': sorted(files, key=lambda file: file['path'])}


def movers_oracle(store_root, catalog):
    record = catalog_record(catalog, 'movers', MOVERS_RECORD_ID)
    manifest = read_pinned_json(store_root, store_relative_path(record['manifest']), record['manifestSha256'])
    return {'recordId': record['id'], 'manifestSha256': record['manifestSha256'], 'sourceMapSha256': record['sourceMapSha256'],
            'terrainSha256': record['terrainSha256'], 'moverIds': sorted(mover['id'] for mover in manifest['movers']),
            'modelIds': sorted(model['id'] for model in manifest['models'])}


def freeze_world_oracle(store_root):
    catalog_payload = read_bounded_store_bytes(store_root, CATALOG_FILE_NAME)
    catalog = decode_json_object(catalog_payload, CATALOG_FILE_NAME)
    try:
        oracle = {'schemaVersion': WORLD_ORACLE_SCHEMA_VERSION, 'catalogSha256': sha256_hex(catalog_payload),
                  'section': section_oracle(store_root, catalog), 'sky': sky_oracle(store_root), 'environment': environment_oracle(store_root),
                  'movers': movers_oracle(store_root, catalog)}
    except (KeyError, TypeError) as error:
        raise WorldOracleError(f'junction manifest is missing a field the oracle needs: {error!r}') from error
    return validate_world_oracle(oracle)


def is_hash_field(field_name):
    return field_name == 'sha256' or field_name.endswith('Sha256')


def require_no_encoded_payload(value, field_name):
    if isinstance(value, dict):
        for key, item in value.items():
            require_no_encoded_payload(item, key)
    elif isinstance(value, list):
        for item in value:
            require_no_encoded_payload(item, field_name)
    elif isinstance(value, str):
        if is_hash_field(field_name):
            if not SHA256_TEXT_PATTERN.fullmatch(value):
                raise WorldOracleError(f'oracle field {field_name} must be 64 lowercase hex characters: {value!r}')
        elif LONG_ENCODED_RUN_PATTERN.search(value):
            raise WorldOracleError(f'oracle field {field_name} holds an encoded run longer than 64 characters')


def require_sorted_unique(items, description):
    if items != sorted(set(items)):
        raise WorldOracleError(f'oracle {description} must be sorted with no repeats')


def validate_world_oracle(oracle):
    if not (isinstance(oracle, dict) and set(oracle) == ORACLE_FIELDS and oracle['schemaVersion'] == WORLD_ORACLE_SCHEMA_VERSION):
        raise WorldOracleError(f'world oracle must be schemaVersion {WORLD_ORACLE_SCHEMA_VERSION} with exactly {", ".join(sorted(ORACLE_FIELDS))}')
    section, movers = oracle['section'], oracle['movers']
    if not (isinstance(section, dict) and set(section) == SECTION_FIELDS and isinstance(movers, dict) and set(movers) == MOVERS_FIELDS):
        raise WorldOracleError('world oracle section or movers fields differ from the oracle schema')
    if (section['modelCount'], section['placementCount']) != (len(section['models']), len(section['placements'])):
        raise WorldOracleError('world oracle section counts differ from its model and placement lists')
    for description, items in (('models', [model['id'] for model in section['models']]),
                               ('placements', [placement['id'] for placement in section['placements']]),
                               ('terrain patches', [patch['id'] for patch in section['terrainPatches']]),
                               ('bsp records', [bsp['id'] for bsp in section['bsp']]),
                               ('unsupported runtime materials', section['unsupportedRuntimeMaterialIds']),
                               ('sky files', [file['path'] for file in oracle['sky']['files']]),
                               ('environment files', [file['path'] for file in oracle['environment']['files']]),
                               ('mover ids', movers['moverIds']), ('mover model ids', movers['modelIds'])):
        require_sorted_unique(items, description)
    require_no_encoded_payload(oracle, 'oracle')
    return oracle


def world_oracle_bytes(oracle):
    return canonical_json_bytes(validate_world_oracle(oracle))


def world_oracle_summary(oracle):
    section = oracle['section']
    return {'output': WORLD_ORACLE_RELATIVE_PATH, 'catalogSha256': oracle['catalogSha256'], 'sectionManifestSha256': section['manifestSha256'],
            'models': section['modelCount'], 'placements': section['placementCount'], 'bsp': [bsp['id'] for bsp in section['bsp']],
            'terrainPatches': len(section['terrainPatches']), 'unsupportedRuntimeMaterials': len(section['unsupportedRuntimeMaterialIds']),
            'skyManifestSha256': oracle['sky']['manifestSha256'], 'skyFiles': len(oracle['sky']['files']),
            'environmentManifestSha256': oracle['environment']['manifestSha256'], 'moversManifestSha256': oracle['movers']['manifestSha256'],
            'movers': len(oracle['movers']['moverIds']), 'moverModels': len(oracle['movers']['modelIds'])}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Freeze the 20_20 world oracle from a native store root, read only, into the committed recipe.')
    parser.add_argument('--store-root', type=Path, default=DEFAULT_STORE_ROOT)
    arguments = parser.parse_args(argv)
    try:
        require_committed_destination(WORLD_ORACLE_RELATIVE_PATH)
        oracle = freeze_world_oracle(arguments.store_root)
        write_committed_world_bytes(WORLD_ORACLE_RELATIVE_PATH, world_oracle_bytes(oracle))
    except (OSError, ValueError) as error:
        print(f'World oracle freeze failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps(world_oracle_summary(oracle), indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
