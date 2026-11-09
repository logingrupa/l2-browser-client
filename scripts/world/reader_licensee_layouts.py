from data.pinned_elbera_module import ELBERA_COMMIT
from native_assets_lib.texture_mips import LAYOUT_EVIDENCE as TEXTURE_LAYOUT_EVIDENCE
from native_catalog.ue2 import FormatError
from world.elbera_reader_cross_check import ELBERA_L2LIB_PINS, ELBERA_UE2PACKAGE_PATH

G16_HEIGHTMAP_READER = 'g16-heightmap'
MAP_ACTOR_READER = 'map-actor'
TERRAIN_INFO_READER = 'terrain-info'
RAW_MAP_READER = 'raw-map'
MAP_READERS = (MAP_ACTOR_READER, TERRAIN_INFO_READER, RAW_MAP_READER)
REVIEWED_PACKAGE_VERSION = 123
BASELINE_LICENSEE = 28
WORLD_READER_FIXTURE_FOLDER = 'tests/fixtures/world-readers'
NO_MATERIAL_PREFIX = 'none'
RESERVED_INT32_MATERIAL_PREFIX = 'reserved-int32'
SHADER_BLOCK_MATERIAL_PREFIX = 'reserved-int32-and-shader-block'
LINEAGE_MATERIAL_MINIMUM_PACKAGE_VERSION = 123
LINEAGE_RESERVED_INT32_LICENSEES = range(16, 37)
LINEAGE_SHADER_BLOCK_LICENSEES = range(30, 37)
ELBERA_SOURCE_NAME = 'Elbera'
ELBERA_L2LIB_README_PATH = 'tools/l2lib/README.md'
ELBERA_L2LIB_README_SHA256 = '32b12d39022a92f4fef951edbecf4094c0a01a8237531c92d81918da752f0a9c'
ELBERA_TERRAIN_SERIALIZE_PATH = 'docs/native-terrain-collision-inputs.md'
ELBERA_TERRAIN_SERIALIZE_SHA256 = 'eee0d53e2d84c8a8c51c2b8854c5fe842a78e3cfbf77256b46cedd7d58f7da03'
UEVIEWER_MATERIAL_HEADER_PATH = 'Unreal/UnrealMaterial/UnMaterial2.h'
READER_GAP_REASON_TEMPLATES = {
    G16_HEIGHTMAP_READER: ('terrain-height-version-unsupported:{version}', 'terrain-height-licensee-unsupported:{version}/{licensee}'),
    **{reader: ('map-version-unsupported:{version}', 'map-licensee-unsupported:{version}/{licensee}') for reader in MAP_READERS},
}


def layout_evidence(source, commit, file, sha256, section):
    return {'source': source, 'commit': commit, 'file': file, 'sha256': sha256, 'section': section}


MATERIAL_FIELD_EVIDENCE = (
    layout_evidence(ELBERA_SOURCE_NAME, ELBERA_COMMIT, ELBERA_L2LIB_README_PATH, ELBERA_L2LIB_README_SHA256,
                    'Lineage2 UMaterial extra fields (v123 packages); Texture export body'),
    layout_evidence(TEXTURE_LAYOUT_EVIDENCE['repository'], TEXTURE_LAYOUT_EVIDENCE['revision'], UEVIEWER_MATERIAL_HEADER_PATH,
                    TEXTURE_LAYOUT_EVIDENCE['files'][UEVIEWER_MATERIAL_HEADER_PATH],
                    'UMaterial::Serialize LINEAGE2 block, secondary reference cited by repository and revision'),
)
ACTOR_PROPERTY_EVIDENCE = (
    layout_evidence(ELBERA_SOURCE_NAME, ELBERA_COMMIT, ELBERA_L2LIB_README_PATH, ELBERA_L2LIB_README_SHA256,
                    'Property tags, packed UE1-style variant'),
    layout_evidence(ELBERA_SOURCE_NAME, ELBERA_COMMIT, ELBERA_UE2PACKAGE_PATH, ELBERA_L2LIB_PINS[ELBERA_UE2PACKAGE_PATH],
                    'module docstring RF_HasStack FStateFrame; read_state_frame; _read_props_packed'),
)
TERRAIN_INFO_EVIDENCE = (
    *ACTOR_PROPERTY_EVIDENCE,
    layout_evidence(ELBERA_SOURCE_NAME, ELBERA_COMMIT, ELBERA_TERRAIN_SERIALIZE_PATH, ELBERA_TERRAIN_SERIALIZE_SHA256,
                    'Source bindings: ATerrainInfo::Serialize, licensee version 17 or later writes sector references and counts'),
)
READER_EVIDENCE = {G16_HEIGHTMAP_READER: MATERIAL_FIELD_EVIDENCE, MAP_ACTOR_READER: ACTOR_PROPERTY_EVIDENCE,
                   TERRAIN_INFO_READER: TERRAIN_INFO_EVIDENCE, RAW_MAP_READER: ACTOR_PROPERTY_EVIDENCE}
READER_FIXTURE_STEMS = {G16_HEIGHTMAP_READER: 'g16-heightmap', **{reader: 'map' for reader in MAP_READERS}}
REVIEWED_LICENSEE_CROSS_CHECK_TILES = {
    G16_HEIGHTMAP_READER: {28: '20_21', 25: '16_11', 23: '18_24', 12: '15_22', 20: '16_21', 22: '19_21'},
    MAP_ACTOR_READER: {28: '20_21', 30: '17_22', 23: '17_20', 18: '17_18', 31: '19_23', 16: '24_10', 19: '26_11', 20: '24_26', 25: '15_20'},
    TERRAIN_INFO_READER: {28: '20_21', 30: '17_22', 23: '17_20', 18: '17_18', 31: '19_23', 19: '26_11', 20: '24_26', 25: '15_20'},
    RAW_MAP_READER: {28: '20_21', 30: '17_22', 23: '17_20', 18: '17_18', 31: '19_23', 16: '24_10', 19: '26_11', 20: '24_26', 25: '15_20'},
}


def lineage_material_prefix(package_version, licensee_version):
    if package_version < LINEAGE_MATERIAL_MINIMUM_PACKAGE_VERSION or licensee_version not in LINEAGE_RESERVED_INT32_LICENSEES:
        return NO_MATERIAL_PREFIX
    if licensee_version in LINEAGE_SHADER_BLOCK_LICENSEES:
        return SHADER_BLOCK_MATERIAL_PREFIX
    return RESERVED_INT32_MATERIAL_PREFIX


def material_prefix_differences(licensee_version):
    prefix = lineage_material_prefix(REVIEWED_PACKAGE_VERSION, licensee_version)
    baseline = lineage_material_prefix(REVIEWED_PACKAGE_VERSION, BASELINE_LICENSEE)
    return [] if prefix == baseline else [f'UMaterial prefix after the property stream is {prefix}, not {baseline}']


def reader_fixture_path(reader, licensee_version):
    return f'{WORLD_READER_FIXTURE_FOLDER}/{READER_FIXTURE_STEMS[reader]}-{REVIEWED_PACKAGE_VERSION}-{licensee_version}.json'


def map_material_export_differences(licensee_version):
    return [f'{difference} in material-derived map exports; the map readers keep those exports raw and never decode them'
            for difference in material_prefix_differences(licensee_version)]


def reviewed_reader_layout(reader, licensee_version, cross_check_tile):
    record = {'fixture': reader_fixture_path(reader, licensee_version), 'crossCheck': {'tile': cross_check_tile}}
    if reader == G16_HEIGHTMAP_READER:
        record['differencesFrom123_28'] = material_prefix_differences(licensee_version)
        record['materialPrefix'] = lineage_material_prefix(REVIEWED_PACKAGE_VERSION, licensee_version)
        evidence = READER_EVIDENCE[reader]
    else:
        record['differencesFrom123_28'] = map_material_export_differences(licensee_version)
        evidence = (*READER_EVIDENCE[reader], *(MATERIAL_FIELD_EVIDENCE if record['differencesFrom123_28'] else ()))
    record['evidence'] = [dict(entry) for entry in evidence]
    return record


READER_LICENSEE_LAYOUTS = {
    reader: {(REVIEWED_PACKAGE_VERSION, licensee): reviewed_reader_layout(reader, licensee, tile) for licensee, tile in tiles.items()}
    for reader, tiles in REVIEWED_LICENSEE_CROSS_CHECK_TILES.items()
}


def reader_layouts(reader):
    if reader not in READER_LICENSEE_LAYOUTS:
        raise ValueError(f'unknown world reader {reader!r}; known readers are {sorted(READER_LICENSEE_LAYOUTS)}')
    return READER_LICENSEE_LAYOUTS[reader]


def reviewed_reader_pairs(reader):
    return sorted(reader_layouts(reader))


def reader_gap_reason(reader, version, licensee):
    version_template, licensee_template = READER_GAP_REASON_TEMPLATES[reader]
    if all(reviewed_version != version for reviewed_version, _ in reader_layouts(reader)):
        return version_template.format(version=version)
    return licensee_template.format(version=version, licensee=licensee)


def require_reviewed_reader_layout(reader, package_summary):
    version, licensee = package_summary['version'], package_summary['licenseeVersion']
    record = reader_layouts(reader).get((version, licensee))
    if record is None:
        raise FormatError(reader_gap_reason(reader, version, licensee))
    return record
