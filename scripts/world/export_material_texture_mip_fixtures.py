from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import base64
import json

from native_assets_lib.texture_mips import build_texture_source
from native_assets_lib.texture_package_118 import read_unreal_package
from reference_client_guard import require_reference_client
from world.export_day_night_fixtures import FIXTURES_ROOT, require, require_output_directory_inside_fixtures, rows_per_line_json

DEFAULT_OUTPUT_DIRECTORY = FIXTURES_ROOT / 'material-textures'
FIXTURES_OUTPUT_NAME = 'native-mip-chains.json'
SKY_TEXTURE_PACKAGE = 'textures/l2_skies.utx'
FIXTURE_TEXTURES = (
    (SKY_TEXTURE_PACKAGE, 'l2_skies.Textures.WhiteChip'), (SKY_TEXTURE_PACKAGE, 'l2_skies.FlareSet.Sun01'),
    (SKY_TEXTURE_PACKAGE, 'l2_skies.FlareSet.Flare01'), (SKY_TEXTURE_PACKAGE, 'l2_skies.Textures.mongebg'),
    ('textures/dion_curumadungeon_t.utx', 'dion_curumadungeon_t.cm_dg_etc'), ('textures/cruma_tr_t.utx', 'cruma_tr_t.Cm_o_wall008'),
)


def texture_export_named(package, texture_object):
    matches = [item for item in package.exports if item['className'] == 'Texture' and item['object'] == texture_object]
    require(len(matches) == 1, f'{package.filename} holds {len(matches)} Texture exports named {texture_object}, not one')
    return matches[0]


def native_mip_chain_fixture(package, package_path, texture_object):
    item = texture_export_named(package, texture_object)
    metadata, files = build_texture_source(package, item)
    return {'package': package_path, 'packageSha256': package.source_hash, 'object': texture_object, 'exportIndex': item['exportIndex'],
            'format': metadata['format']['name'], 'completeTo1x1': metadata['completeTo1x1'],
            'mips': [{'level': mip['level'], 'width': mip['width'], 'height': mip['height'], 'bytes': mip['sourceBytes'], 'sha256': mip['sha256'],
                      'base64': base64.b64encode(files[mip['file']]).decode('ascii')} for mip in metadata['mips']]}


def native_mip_chain_fixtures_document(client_root):
    client_access = require_reference_client(client_root)
    packages = {}
    textures = []
    for package_path, texture_object in FIXTURE_TEXTURES:
        if package_path not in packages:
            source_path = client_access.require_equal_file(package_path)
            packages[package_path] = read_unreal_package(source_path.read_bytes(), source_path.name)
        textures.append(native_mip_chain_fixture(packages[package_path], package_path, texture_object))
    return {'schemaVersion': 2, 'kind': 'native-texture-mip-chain-fixtures', 'source': {'reader': 'native_assets_lib.texture_mips.build_texture_source'},
            'textures': textures}


def export_material_texture_mip_fixtures(client_root, output_directory=DEFAULT_OUTPUT_DIRECTORY):
    output = require_output_directory_inside_fixtures(output_directory)
    data = rows_per_line_json(native_mip_chain_fixtures_document(client_root), 'textures')
    output.mkdir(parents=True, exist_ok=True)
    (output / FIXTURES_OUTPUT_NAME).write_bytes(data)
    return {FIXTURES_OUTPUT_NAME: len(data)}


def main(arguments):
    parser = argparse.ArgumentParser(description='Write native texture mip chain fixtures from reference client texture packages into tests/fixtures.')
    parser.add_argument('--client-root', required=True)
    parser.add_argument('--output-directory', default=str(DEFAULT_OUTPUT_DIRECTORY))
    options = parser.parse_args(arguments)
    try:
        require_reference_client(options.client_root)
        written = export_material_texture_mip_fixtures(options.client_root, options.output_directory)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(written, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
