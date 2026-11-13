import functools
import hashlib
import json
import re

from native_store.store_paths import REPOSITORY_ROOT
from reference_client_guard import REFERENCE_CLIENT_LOCK_PATH, read_reference_client_lock

MINIMAP_RADAR_ROUTE_RECIPE_RELATIVE_PATH = 'recipes/world/minimap-radar-route.json'
MINIMAP_RADAR_ROUTE_KIND = 'minimap-radar-route'
JOIN_UNRESOLVED_REASON_PREFIX = 'minimap-join-unresolved:'
SHA256_HEX = re.compile(r'[0-9a-f]{64}')
HEX_VALUE = re.compile(r'0x[0-9a-f]+')
DOCUMENT_FIELDS = {'schemaVersion', 'kind', 'binaries', 'verification', 'radar', 'textureFormat5', 'worldMap', 'zoneSampler', 'zoneKey', 'open'}
PINNED_BINARY_PATHS = ('system/interface.u', 'system/nwindow.u', 'system/Core.dll', 'system/engine.dll', 'system/nwindow.dll', 'system/Localization.ini')
FACTS_NAMES = ('minimapRadar', 'textureFormats', 'zoneSampler')
ADDRESSED_RULES = (('radar', 'match'), ('textureFormat5', 'getFormatDesc'), ('worldMap', 'initializeMapDisplay'), ('worldMap', 'drawWorldMap'),
                   ('worldMap', 'getMinimapPosition'), ('zoneSampler', 'sampler'), ('zoneSampler', 'lookup'), ('zoneKey', 'serialize'),
                   ('zoneKey', 'helper'))
RADAR_EVENT_NAMES = ('zoneTitleEvent', 'zoneCodeEvent')
RADAR_SCRIPT_NAMES = ('onLoad', 'onEvent', 'getLocInfo')
CASE_FIELDS ={'zoneName', 'texture', 'mapX', 'mapY'}
DEFAULT_FIELDS = {'texture', 'mapX', 'mapY', 'isGlobal'}
OPEN_FIELDS = {'id', 'what', 'tileGap', 'scope'}
PIXEL_CHANNELS = {'R', 'G', 'B', 'A'}
SAMPLER_INTEGER_FIELDS = ('worldOffsetX', 'worldOffsetY', 'tileSize', 'tileBias', 'originTileX', 'originTileY', 'missingTextureKey')
PROJECTION_INTEGER_FIELDS = ('offsetX', 'offsetY', 'scaleNumerator', 'scaleDenominator')


class MinimapRadarRouteRecipeError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise MinimapRadarRouteRecipeError(f'{MINIMAP_RADAR_ROUTE_RECIPE_RELATIVE_PATH}: {message}')


def refuse_duplicate_keys(pairs):
    keys = [key for key, _ in pairs]
    require(len(keys) == len(set(keys)), f'repeats a JSON key in {sorted(keys)}')
    return dict(pairs)


def refuse_non_finite_number(value):
    raise MinimapRadarRouteRecipeError(f'{MINIMAP_RADAR_ROUTE_RECIPE_RELATIVE_PATH}: holds the non-finite number {value}')


def is_integer(value):
    return type(value) is int


def is_positive_integer(value):
    return is_integer(value) and value > 0


def is_text(value):
    return isinstance(value, str) and value != ''


def is_hex(value):
    return isinstance(value, str) and HEX_VALUE.fullmatch(value) is not None


def require_section(document, name):
    section = document[name]
    require(isinstance(section, dict), f'{name} must be an object')
    return section


def require_binaries(binaries, lock_path):
    require(isinstance(binaries, list) and all(isinstance(binary, dict) for binary in binaries), 'binaries must list objects')
    paths = [binary.get('path') for binary in binaries]
    require(sorted(map(str.casefold, map(str, paths))) == sorted(path.casefold() for path in PINNED_BINARY_PATHS),
            f'binaries must pin exactly {list(PINNED_BINARY_PATHS)}')
    lock = read_reference_client_lock(lock_path)
    for binary in binaries:
        require(set(binary) <= {'path', 'eSha256', 'lockClass', 'imageBase'} and SHA256_HEX.fullmatch(str(binary.get('eSha256'))),
                f'binary {binary["path"]} needs its eSha256 and lock class')
        record = lock.record(binary['path'])
        require(record is not None and record['eSha256'] == binary['eSha256'] and record['class'] == binary.get('lockClass'),
                f'pin {binary["eSha256"]} of {binary["path"]} differs from the {binary["path"].casefold()} entry of the reference client lock')
        require('imageBase' not in binary or is_hex(binary['imageBase']), f'binary {binary["path"]} image base is not hex')


def require_verification(verification):
    require(isinstance(verification, dict) and is_text(verification.get('date')), 'verification needs its date')
    workflows = verification.get('workflows')
    require(isinstance(workflows, list) and workflows and all(isinstance(entry, dict) and is_text(entry.get('id')) and is_text(entry.get('scope'))
                                                               for entry in workflows), 'verification needs its workflows')
    facts = verification.get('factsSha256')
    require(isinstance(facts, dict) and set(facts) == set(FACTS_NAMES) and all(SHA256_HEX.fullmatch(str(value)) for value in facts.values()),
            f'verification needs the SHA-256 of the facts {list(FACTS_NAMES)}')


def require_addressed_rules(document):
    binary_paths = {binary['path'].casefold() for binary in document['binaries']}
    for section_name, rule_name in ADDRESSED_RULES:
        rule = document[section_name].get(rule_name)
        label = f'{section_name}.{rule_name}'
        require(isinstance(rule, dict) and is_text(rule.get('function')), f'rule {label} needs its function')
        require(is_hex(rule.get('address')), f'rule {label} needs its hex address')
        require(str(rule.get('binary')).casefold() in binary_paths, f'rule {label} names a binary the recipe does not pin')


def require_radar(radar):
    cases = radar.get('cases')
    require(isinstance(cases, list) and cases, 'radar needs its cases')
    for case in cases:
        require(isinstance(case, dict) and set(case) == CASE_FIELDS, f'every radar case needs exactly {sorted(CASE_FIELDS)}')
        require(is_text(case['zoneName']) and is_text(case['texture']) and is_integer(case['mapX']) and is_integer(case['mapY']),
                f'radar case {case.get("zoneName")!r} needs a zone name, a texture, mapX and mapY')
    folded = [case['zoneName'].casefold() for case in cases]
    require(len(folded) == len(set(folded)), 'two radar cases are equal under the case-insensitive match')
    default = radar.get('default')
    require(isinstance(default, dict) and set(default) == DEFAULT_FIELDS and is_text(default['texture']) and is_integer(default['mapX'])
            and is_integer(default['mapY']) and default['isGlobal'] is True, f'radar default needs exactly {sorted(DEFAULT_FIELDS)} with isGlobal true')
    require(is_text(radar.get('texturePackage')) and is_text(radar.get('textureGroup')), 'radar needs its texture package and group')
    require(all(isinstance(radar.get(name), dict) and is_integer(radar[name].get('id')) for name in RADAR_EVENT_NAMES), 'radar needs its event ids')
    require(all(isinstance(radar.get(name), dict) and is_integer(radar[name].get('export')) for name in RADAR_SCRIPT_NAMES),
            'radar needs its script exports')
    location = radar['getLocInfo']
    require(is_hex(location.get('serialOffset')) and is_hex(location.get('bytecodeOffset')) and is_positive_integer(location.get('scriptSize')),
            'radar getLocInfo needs its serial offset, bytecode offset and script size')


def require_texture_format5(texture_format):
    require(is_positive_integer(texture_format.get('formatId')) and is_text(texture_format.get('formatName')), 'textureFormat5 needs its format id and name')
    order = texture_format.get('pixelOrder')
    require(isinstance(order, list) and len(order) == 4 and set(order) == PIXEL_CHANNELS, 'textureFormat5 pixel order must name R, G, B and A once')
    require(texture_format.get('bytesPerPixel') == len(order), 'textureFormat5 bytes per pixel must equal its channel count')
    material_int = texture_format.get('materialInt')
    require(isinstance(material_int, dict) and all(is_integer(material_int.get(name)) for name in ('bytes', 'minimumPackageVersion', 'minimumLicensee')),
            'textureFormat5 needs the material int rule')
    package = texture_format.get('package')
    require(isinstance(package, dict) and is_text(package.get('path')) and is_hex(package.get('key'))
            and is_integer(package.get('packageVersion')) and is_integer(package.get('licensee')), 'textureFormat5 needs its package layout')
    mip = texture_format.get('townMapMip')
    require(isinstance(mip, dict) and all(is_positive_integer(mip.get(name)) for name in ('count', 'width', 'height', 'bytes'))
            and mip['bytes'] == mip['width'] * mip['height'] * texture_format['bytesPerPixel'], 'textureFormat5 town map mip size differs from its pixels')


def require_world_map(world_map):
    display, draw, position = world_map['initializeMapDisplay'], world_map['drawWorldMap'], world_map['getMinimapPosition']
    require(is_text(display.get('english')) and is_text(display.get('fallback')), 'worldMap display needs its English key and fallback')
    require(all(is_positive_integer(draw.get(name)) for name in ('columns', 'rows', 'pieceWidth', 'pieceHeight')), 'worldMap draw needs its piece grid')
    suffixes = display.get('suffixes')
    require(suffixes == list(range(1, draw['columns'] * draw['rows'] + 1)), 'worldMap suffixes must number every piece of the grid once')
    require(all(is_integer(position.get(name)) for name in PROJECTION_INTEGER_FIELDS) and position['scaleDenominator'] > 0,
            'worldMap projection needs its offsets and scale')
    require(position.get('scale') == position['scaleNumerator'] / position['scaleDenominator'], 'worldMap projection scale differs from 41/8192')


def require_zone_sampler(sampler):
    require(all(is_integer(sampler.get(name)) for name in SAMPLER_INTEGER_FIELDS) and sampler['tileSize'] > 0, 'zoneSampler needs its integer constants')
    require(sampler.get('clamp') is False and is_text(sampler.get('texture')) and is_text(sampler.get('texturePackage')),
            'zoneSampler needs its texture, its package and no clamp')
    constants = sampler.get('constants')
    require(isinstance(constants, list) and constants and all(isinstance(entry, dict) and set(entry) == {'address', 'value'} and is_hex(entry['address'])
                                                              and isinstance(entry['value'], float) for entry in constants),
            'zoneSampler constants need their address and value')
    require(isinstance(sampler.get('formulas'), list) and all(is_text(formula) for formula in sampler['formulas']), 'zoneSampler needs its formulas')


def require_zone_key(zone_key):
    helper = zone_key['helper']
    require(is_positive_integer(helper.get('globalBelowColor')) and helper.get('compare') == 'signed', 'zoneKey helper needs its signed color limit')
    require(isinstance(zone_key['serialize'].get('fields'), list) and is_text(zone_key.get('table')), 'zoneKey needs its serialized fields and table')
    require(isinstance(zone_key.get('keyRun'), dict) and is_text(zone_key['keyRun'].get('rowRule')), 'zoneKey needs its key run rule')


def require_open(open_items):
    require(isinstance(open_items, list) and open_items, 'open must list the unresolved items')
    for item in open_items:
        require(isinstance(item, dict) and set(item) == OPEN_FIELDS and is_text(item['id']) and is_text(item['what']) and is_text(item['scope']),
                f'every open item needs exactly {sorted(OPEN_FIELDS)}')
        require(item['tileGap'] is None or (is_text(item['tileGap']) and item['tileGap'].startswith(JOIN_UNRESOLVED_REASON_PREFIX)),
                f'open item {item["id"]} tile gap must be null or a {JOIN_UNRESOLVED_REASON_PREFIX} reason')
    require(len({item['id'] for item in open_items}) == len(open_items), 'open repeats an item id')


def validate_minimap_radar_route_document(document, lock_path=REFERENCE_CLIENT_LOCK_PATH):
    require(isinstance(document, dict) and set(document) == DOCUMENT_FIELDS, f'fields must be {sorted(DOCUMENT_FIELDS)}')
    require(document['schemaVersion'] == 1 and document['kind'] == MINIMAP_RADAR_ROUTE_KIND, 'is not a minimap-radar-route v1 recipe')
    require_binaries(document['binaries'], lock_path)
    require_verification(document['verification'])
    for name in ('radar', 'textureFormat5', 'worldMap', 'zoneSampler', 'zoneKey'):
        require_section(document, name)
    require_addressed_rules(document)
    require_radar(document['radar'])
    require_texture_format5(document['textureFormat5'])
    require_world_map(document['worldMap'])
    require_zone_sampler(document['zoneSampler'])
    require_zone_key(document['zoneKey'])
    require_open(document['open'])
    return document


def load_minimap_radar_route_recipe(path, lock_path=REFERENCE_CLIENT_LOCK_PATH):
    require(path.is_file(), 'is missing')
    payload = path.read_bytes()
    try:
        document = json.loads(payload, object_pairs_hook=refuse_duplicate_keys, parse_constant=refuse_non_finite_number)
    except json.JSONDecodeError as error:
        raise MinimapRadarRouteRecipeError(f'{MINIMAP_RADAR_ROUTE_RECIPE_RELATIVE_PATH} is not JSON: {error}') from error
    return {'path': MINIMAP_RADAR_ROUTE_RECIPE_RELATIVE_PATH, 'sha256': hashlib.sha256(payload).hexdigest(),
            'document': validate_minimap_radar_route_document(document, lock_path)}


@functools.cache
def read_minimap_radar_route_recipe():
    return load_minimap_radar_route_recipe(REPOSITORY_ROOT / MINIMAP_RADAR_ROUTE_RECIPE_RELATIVE_PATH)
