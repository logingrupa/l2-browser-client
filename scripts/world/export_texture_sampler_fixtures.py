from pathlib import Path
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import hashlib
import json

from native_assets_lib.material_texture_mip_chain import texture_min_lod
from native_assets_lib.texture_mips import build_texture_source
from native_assets_lib.texture_package_118 import read_unreal_package
from reference_client_guard import require_reference_client
from world.export_day_night_fixtures import FIXTURES_ROOT, read_pinned_json, require, require_output_directory_inside_fixtures

TEXTURE_SAMPLERS_REPORT_SHA256 = 'fc0169fe76524dd3a118474b9211e1b55b182870be3ddf9274d38431d619c1a5'
TEXTURE_SAMPLERS_MANIFEST_SHA256 = '96c23b853520cbc058fd1d96feaa44c5c18e4ef397d566787bbaec3f505e06c9'
REPORT_FILE_NAME = 'texture-samplers.json'
MANIFEST_RELATIVE_PATH = Path('texture-samplers-rm25') / 'manifest.json'
DEFAULT_OUTPUT_DIRECTORY = FIXTURES_ROOT / 'rm25'
FIXTURES_OUTPUT_NAME = 'texture-samplers-native.json'
EXPECTED_FIXTURE_COUNTS = {'mips': 16, 'mipMappings': 6, 'samplers': 10}
FIXTURE_FIELDS_BY_KIND = {'mips': ('function', 'input', 'output'), 'mipMappings': ('input', 'effectiveMipCount', 'firstMip', 'd3dLevelCount', 'mapping'),
                          'samplers': ('function', 'name', 'input', 'output')}
RUNTIME_GLOBAL_NAMES_BY_ADDRESS = {'0x102373a0': 'GL2UseTrilinear', '0x1023f990': 'GL2TextureDetail', '0x1023f9ac': 'GL2KeepMinFrameRate'}
RUNTIME_GLOBAL_EVIDENCE = 'verified-texture-samplers.md: Engine 0x10578490 reads Option.ini [Video] through GConfig into the Core exports at these addresses'
CONFIGURATION_FILE_BY_SECTION = {'D3DDrv.D3DRenderDevice': 'l2Ini', 'Video': 'optionIni'}
LIGHTMAP_LIVE_TEXTURE = 'FStaticLightMapTexture'
TEXTURE_PACKAGE_FOLDER = 'textures'
TEXTURE_PACKAGE_EXTENSION = '.utx'


def pinned_texture_samplers_report(delivery_root):
    manifest = read_pinned_json(Path(delivery_root) / MANIFEST_RELATIVE_PATH, TEXTURE_SAMPLERS_MANIFEST_SHA256, 'the RM-25 manifest')
    listed = [entry.get('sha256') for entry in manifest.get('files', []) if entry.get('file') == REPORT_FILE_NAME]
    require(listed == [TEXTURE_SAMPLERS_REPORT_SHA256], f'the RM-25 manifest lists {listed} for {REPORT_FILE_NAME}, not the pinned {TEXTURE_SAMPLERS_REPORT_SHA256}')
    return read_pinned_json(Path(delivery_root) / REPORT_FILE_NAME, TEXTURE_SAMPLERS_REPORT_SHA256, 'the RM-25 texture sampler report')


def live_texture_package_path(texture_name):
    return f'{TEXTURE_PACKAGE_FOLDER}/{texture_name.split(".", 1)[0].lower()}{TEXTURE_PACKAGE_EXTENSION}'


def report_fixtures(report):
    fixtures = report['fixtures']
    for kind, count in EXPECTED_FIXTURE_COUNTS.items():
        require(isinstance(fixtures.get(kind), list) and len(fixtures[kind]) == count, f'the RM-25 report must hold {count} {kind} fixtures')
    return {kind: [{field: row[field] for field in FIXTURE_FIELDS_BY_KIND[kind]} for row in fixtures[kind]] for kind in EXPECTED_FIXTURE_COUNTS}


def configuration(report):
    values = {name: {} for name in CONFIGURATION_FILE_BY_SECTION.values()}
    for row in report['config']:
        values[CONFIGURATION_FILE_BY_SECTION[row['section']]][row['key']] = row['valueText']
    runtime_globals = {RUNTIME_GLOBAL_NAMES_BY_ADDRESS[entry['va']]: entry['value'] for entry in report['liveSettings']['runtimeGlobals']}
    require(set(runtime_globals) == set(RUNTIME_GLOBAL_NAMES_BY_ADDRESS.values()), f'the RM-25 live settings hold the globals {sorted(runtime_globals)}')
    return {**values, 'runtimeGlobals': runtime_globals, 'runtimeGlobalEvidence': RUNTIME_GLOBAL_EVIDENCE,
            'liveRenderDevice': {key: report['liveSettings'][key] for key in ('UseTrilinear', 'LevelOfAnisotropy', 'DetailTexMipBias', 'DefaultTexMipBias')}}


def live_ordinary_stages(report):
    stages = {}
    for sample in report['liveSummary']:
        for stage in sample['boundStages']:
            if stage['texture'] != LIGHTMAP_LIVE_TEXTURE:
                stages.setdefault(stage['texture'], stage)
    return stages


def texture_export_named(package, texture_name):
    matches = [item for item in package.exports if item['className'] == 'Texture' and item['object'].casefold() == texture_name.casefold()]
    require(len(matches) == 1, f'{package.filename} holds {len(matches)} Texture exports named {texture_name}, not one')
    return matches[0]


def live_texture(client_root, packages, texture_name, stage):
    relative_path = live_texture_package_path(texture_name)
    if relative_path not in packages:
        package_path = require_reference_client(client_root).require_equal_file(relative_path)
        packages[relative_path] = read_unreal_package(package_path.read_bytes(), package_path.name)
    package = packages[relative_path]
    metadata, _ = build_texture_source(package, texture_export_named(package, texture_name))
    return {'texture': texture_name, 'package': relative_path, 'packageSha256': package.source_hash, 'format': metadata['format']['name'],
            'minLod': texture_min_lod(metadata), 'storedMipCount': metadata['mipCount'],
            'storedMipDimensions': [[mip['width'], mip['height']] for mip in metadata['mips']],
            'live': {'levelCount': stage['levelCount'], 'firstSourceMip': stage['firstSourceMip'], 'size': stage['size']}}


def texture_sampler_fixtures_document(report, client_root):
    packages = {}
    return {'schemaVersion': 1, 'kind': 'rm25-texture-samplers-native',
            'source': {'report': REPORT_FILE_NAME, 'reportSha256': TEXTURE_SAMPLERS_REPORT_SHA256, 'manifestSha256': TEXTURE_SAMPLERS_MANIFEST_SHA256,
                       'question': report['question'], 'packageReader': 'native_assets_lib.texture_mips.build_texture_source'},
            'configuration': configuration(report), 'liveSummary': report['liveSummary'],
            'liveTextures': [live_texture(client_root, packages, name, stage) for name, stage in live_ordinary_stages(report).items()],
            'fixtures': report_fixtures(report)}


def export_texture_sampler_fixtures(delivery_root, client_root, output_directory=DEFAULT_OUTPUT_DIRECTORY):
    output = require_output_directory_inside_fixtures(output_directory)
    document = texture_sampler_fixtures_document(pinned_texture_samplers_report(delivery_root), client_root)
    data = (json.dumps(document, indent=1, ensure_ascii=True) + '\n').encode('utf-8')
    output.mkdir(parents=True, exist_ok=True)
    (output / FIXTURES_OUTPUT_NAME).write_bytes(data)
    return {FIXTURES_OUTPUT_NAME: hashlib.sha256(data).hexdigest()}


def main(arguments):
    parser = argparse.ArgumentParser(description='Write the RM-25 texture sampler and mip retention fixtures into tests/fixtures/rm25.')
    parser.add_argument('--delivery-root', required=True)
    parser.add_argument('--client-root', required=True)
    parser.add_argument('--output-directory', default=str(DEFAULT_OUTPUT_DIRECTORY))
    options = parser.parse_args(arguments)
    try:
        require_reference_client(options.client_root)
        written = export_texture_sampler_fixtures(options.delivery_root, options.client_root, options.output_directory)
    except (OSError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(written, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
