from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json
from pathlib import PurePosixPath

from native_assets import UMODEL, Converter
from native_assets_lib.lineage_material_prefix import MATERIAL_PREFIX_EVIDENCE, lineage_material_prefix
from native_assets_lib.sha256_identity import sha256_hex_digest
from native_assets_lib.texture_mips import REVIEWED_VERSIONS, read_texture_source_for_layout
from native_assets_lib.texture_package_118 import read_unreal_package
from native_assets_lib.texture_source_reader import FORMATS, P8_FORMAT_ID, UnsupportedTextureSource
from native_catalog.ue2 import FormatError
from native_store.store_paths import REPOSITORY_ROOT, lane_work_root
from reference_client_guard import require_reference_client
from world.elbera_reader_cross_check import elbera_export_named, elbera_package, elbera_tool_record, elbera_ue2package_module

TEXTURE_LAYOUT_FIXTURE_FOLDER = 'tests/fixtures/texture-layouts'
CROSS_CHECKS_RELATIVE_PATH = f'{TEXTURE_LAYOUT_FIXTURE_FOLDER}/cross-checks.json'
FIXTURE_FIELDS = ('expected', 'licensee', 'materialPrefix', 'packageVersion', 'schemaVersion', 'syntheticBody')
CROSS_CHECK_SCHEMA_VERSION = 1
INTEGRATION_LANE = 'integration'
CONVERTER_WORK_FOLDER = 'texture-layouts'
TEXTURE_CLASS_NAME = 'Texture'
REVIEWED_STATUS = 'reviewed'
REFUSED_STATUS = 'refused'
SELECTION_RULE = 'first Texture export in export order whose Format has a reviewed block wrapper and whose leaf name is unique for UModel'
ROW_FIELDS = ('converterNativeMipsEqual', 'elberaMipSha256', 'failingCheck', 'format', 'licensee', 'lockSha256', 'materialPrefix',
              'object', 'ourMipSha256', 'package', 'packageVersion', 'selection', 'status', 'tool')
RECOMPUTED_FIELDS = tuple(field for field in ROW_FIELDS if field != 'converterNativeMipsEqual')


class TextureLayoutCrossCheckError(ValueError):
    pass


def texture_format_id(package, item):
    tags, _ = package.properties(item)
    formats = [tag['value'] for tag in tags if tag['name'] == 'Format']
    return formats[0] if formats else P8_FORMAT_ID


def has_unique_texture_leaf_name(package, item):
    return sum(1 for other in package.exports if other['className'] == TEXTURE_CLASS_NAME and other['name'].casefold() == item['name'].casefold()) == 1


def first_reviewed_format_texture(package):
    for item in package.exports:
        if item['className'] == TEXTURE_CLASS_NAME and texture_format_id(package, item) in FORMATS and has_unique_texture_leaf_name(package, item):
            return item
    raise TextureLayoutCrossCheckError(f'{package.filename} holds no Texture export with a reviewed format and a unique leaf name')


def elbera_texture_mip_payloads(access, relative_path, object_name):
    package = elbera_package(access, relative_path)
    module = elbera_ue2package_module()
    texture = module.parse_texture(package, elbera_export_named(package, object_name))
    return [bytes(module.mip_bytes(package, mip)) for mip in texture.mips]


def our_texture_mip_payloads(package, item):
    metadata, files = read_texture_source_for_layout(package, item)
    return [files[mip['file']] for mip in metadata['mips']]


def material_prefix_rule_failure(layout, reviewed_versions):
    material_prefix = lineage_material_prefix(*layout)
    if material_prefix in {lineage_material_prefix(*reviewed_layout) for reviewed_layout in reviewed_versions}:
        return None
    return f'the Lineage material prefix rule gives {material_prefix}, the prefix of no reviewed layout'


def failing_check(rule_failure, our_hashes, our_error, elbera_hashes, elbera_error):
    if rule_failure is not None:
        return rule_failure
    if our_error is not None:
        return f'our reader refuses the texture: {our_error}'
    if elbera_error is not None:
        return f'Elbera refuses the texture: {elbera_error}'
    if our_hashes != elbera_hashes:
        return 'mip payload SHA-256 values differ from Elbera'
    return None


def texture_layout_cross_check_row(access, relative_path):
    path, lock_sha256 = access.require_equal_file_with_sha256(relative_path)
    package = read_unreal_package(path.read_bytes(), PurePosixPath(relative_path).name)
    item = first_reviewed_format_texture(package)
    our_hashes = our_error = elbera_hashes = elbera_error = None
    try:
        our_hashes = [sha256_hex_digest(payload) for payload in our_texture_mip_payloads(package, item)]
    except (FormatError, UnsupportedTextureSource) as error:
        our_error = str(error)
    try:
        elbera_hashes = [sha256_hex_digest(payload) for payload in elbera_texture_mip_payloads(access, relative_path, item['object'])]
    except Exception as error:
        elbera_error = f'{type(error).__name__}: {error}'
    layout = (package.summary['version'], package.summary['licenseeVersion'])
    check = failing_check(material_prefix_rule_failure(layout, REVIEWED_VERSIONS), our_hashes, our_error, elbera_hashes, elbera_error)
    return {'packageVersion': layout[0], 'licensee': layout[1], 'package': relative_path, 'materialPrefix': lineage_material_prefix(*layout),
            'lockSha256': lock_sha256, 'object': item['object'], 'format': FORMATS[texture_format_id(package, item)],
            'selection': SELECTION_RULE, 'ourMipSha256': our_hashes, 'elberaMipSha256': elbera_hashes,
            'status': REVIEWED_STATUS if check is None else REFUSED_STATUS, 'failingCheck': check, 'tool': elbera_tool_record()}


def converter_native_mip_hashes(client, row):
    output = lane_work_root(REPOSITORY_ROOT, INTEGRATION_LANE) / CONVERTER_WORK_FOLDER
    converter = Converter(client, output, UMODEL)
    conversion = converter.convert({'kind': 'texture', 'package': PurePosixPath(row['package']).stem, 'object': row['object']})
    native_source = json.loads((Path(conversion['file']).parent / 'native-texture-source.json').read_bytes())
    return [mip['sha256'] for mip in native_source['mips']], conversion['sha256']


def with_converter_check(client, row):
    layout = (row['packageVersion'], row['licensee'])
    if row['status'] != REVIEWED_STATUS or layout not in REVIEWED_VERSIONS:
        return {**row, 'converterNativeMipsEqual': None}, None
    converter_hashes, archive_sha256 = converter_native_mip_hashes(client, row)
    return {**row, 'converterNativeMipsEqual': converter_hashes == row['ourMipSha256']}, archive_sha256


def cross_checks_path(project_root):
    return Path(project_root) / CROSS_CHECKS_RELATIVE_PATH


def read_cross_check_rows(project_root):
    path = cross_checks_path(project_root)
    if not path.is_file():
        return []
    document = json.loads(path.read_bytes())
    if not (isinstance(document, dict) and sorted(document) == ['materialPrefixEvidence', 'rows', 'schemaVersion']
            and document['schemaVersion'] == CROSS_CHECK_SCHEMA_VERSION and isinstance(document['rows'], list)
            and document['materialPrefixEvidence'] == list(MATERIAL_PREFIX_EVIDENCE)):
        raise TextureLayoutCrossCheckError(f'{CROSS_CHECKS_RELATIVE_PATH} must be {{schemaVersion {CROSS_CHECK_SCHEMA_VERSION}, '
                                           'materialPrefixEvidence equal to the cited prefix rule evidence, rows}}')
    return document['rows']


def cross_check_row_identity(row):
    return (row['packageVersion'], row['licensee'], row['package'].casefold(), row['object'].casefold())


def write_cross_check_row(project_root, row):
    rows = [existing for existing in read_cross_check_rows(project_root) if cross_check_row_identity(existing) != cross_check_row_identity(row)]
    document = {'schemaVersion': CROSS_CHECK_SCHEMA_VERSION, 'materialPrefixEvidence': list(MATERIAL_PREFIX_EVIDENCE),
                'rows': sorted([*rows, row], key=cross_check_row_identity)}
    path = cross_checks_path(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((json.dumps(document, indent=1, sort_keys=True, ensure_ascii=False) + '\n').encode('utf-8'))


def texture_layout_fixture_path(project_root, layout):
    return Path(project_root) / TEXTURE_LAYOUT_FIXTURE_FOLDER / f'texture-{layout[0]}-{layout[1]}.json'


def read_texture_layout_fixture(project_root, layout):
    path = texture_layout_fixture_path(project_root, layout)
    if not path.is_file():
        raise TextureLayoutCrossCheckError(f'reviewed texture layout {layout[0]}/{layout[1]} has no synthetic fixture {path.name}')
    fixture = json.loads(path.read_bytes())
    if not (isinstance(fixture, dict) and tuple(sorted(fixture)) == FIXTURE_FIELDS and fixture['schemaVersion'] == CROSS_CHECK_SCHEMA_VERSION
            and (fixture['packageVersion'], fixture['licensee']) == layout and fixture['materialPrefix'] == lineage_material_prefix(*layout)):
        raise TextureLayoutCrossCheckError(f'{path.name} must hold {FIXTURE_FIELDS} for layout {layout[0]}/{layout[1]} and its cited material prefix')
    return fixture


def read_texture_layout_fixtures(project_root, reviewed_versions):
    return {layout: read_texture_layout_fixture(project_root, layout) for layout in sorted(reviewed_versions)}


def validate_cross_check_rows(rows, reviewed_versions):
    for row in rows:
        if not (isinstance(row, dict) and tuple(sorted(row)) == ROW_FIELDS):
            raise TextureLayoutCrossCheckError(f'texture layout cross-check row has unexpected fields: {row!r}')
        layout = (row['packageVersion'], row['licensee'])
        if row['status'] == REVIEWED_STATUS:
            if row['failingCheck'] is not None or row['ourMipSha256'] != row['elberaMipSha256'] or not row['ourMipSha256']:
                raise TextureLayoutCrossCheckError(f'reviewed cross-check row {row["package"]} {row["object"]} is not an exact Elbera match')
            if layout in reviewed_versions and row['converterNativeMipsEqual'] is not True:
                raise TextureLayoutCrossCheckError(f'reviewed cross-check row {row["package"]} {row["object"]} lacks an equal Converter conversion')
        elif row['status'] == REFUSED_STATUS:
            if not row['failingCheck'] or layout in reviewed_versions:
                raise TextureLayoutCrossCheckError(f'refused cross-check row {row["package"]} {row["object"]} must name its failing check '
                                                   f'and keep {layout[0]}/{layout[1]} out of the reviewed texture layouts')
        else:
            raise TextureLayoutCrossCheckError(f'cross-check row status must be {REVIEWED_STATUS} or {REFUSED_STATUS}: {row["status"]!r}')
    reviewed_rows = {(row['packageVersion'], row['licensee']) for row in rows if row['status'] == REVIEWED_STATUS}
    missing = sorted(set(reviewed_versions) - reviewed_rows)
    if missing:
        raise TextureLayoutCrossCheckError(f'reviewed texture layouts without an exact Elbera cross-check row: {missing}')
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description='Cross-check one texture of a lock-equal package against the pinned Elbera texture reader '
                                                 'and record the row in ' + CROSS_CHECKS_RELATIVE_PATH + '.')
    parser.add_argument('--client', required=True)
    parser.add_argument('--package', required=True, help='Lock-relative package path, for example systextures/L2UI_CH3.utx')
    arguments = parser.parse_args(argv)
    try:
        access = require_reference_client(arguments.client)
        row, archive_sha256 = with_converter_check(arguments.client, texture_layout_cross_check_row(access, arguments.package))
        write_cross_check_row(REPOSITORY_ROOT, row)
    except (OSError, ValueError) as error:
        print(f'Texture layout cross-check failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps({'row': row, 'converterArchiveSha256': archive_sha256}, indent=1))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
