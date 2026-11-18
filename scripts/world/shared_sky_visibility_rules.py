import functools
import hashlib
import json
from pathlib import Path
import re

from native_store.store_paths import REPOSITORY_ROOT

SHARED_SKY_VISIBILITY_RULES_RELATIVE_PATH = 'recipes/world/shared-sky-visibility.json'
SHARED_SKY_VISIBILITY_RULES_KIND = 'shared-sky-visibility-rules'
SHARED_SKY_VISIBILITY_RULES_SCHEMA_VERSION = 2
DOCUMENT_FIELDS = {'schemaVersion', 'kind', 'sources', 'levelTail', 'nodeSelector', 'viewFrustum', 'requiresSortingRules', 'materialSorting', 'depthClear'}
LEVEL_TAIL_COUNT_FIELDS = ('obsoleteArrayBelowVersion', 'objectReferenceCount', 'stringMapFromVersion', 'stringArrayMigrationFromVersion')
REQUIRES_SORTING_RULE_FIELDS = {'forwarding': ('class', 'field'), 'shader': ('class', 'outputBlendingField', 'opacityField'),
                                'texture': ('class', 'flagField')}
SOURCE_NAMES = ('sharedSkyNodes', 'viewFrustum', 'skyDrawOrder')
SHA256_HEX = re.compile(r'[0-9a-f]{64}')


class SharedSkyVisibilityRulesError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise SharedSkyVisibilityRulesError(f'{SHARED_SKY_VISIBILITY_RULES_RELATIVE_PATH}: {message}')


def is_count(value):
    return type(value) is int and value >= 0


def require_level_tail(tail):
    require(isinstance(tail, dict) and all(is_count(tail.get(field)) for field in LEVEL_TAIL_COUNT_FIELDS), f'levelTail needs {LEVEL_TAIL_COUNT_FIELDS}')
    require(tail['stringArrayMigrationFromVersion'] <= tail['stringMapFromVersion'], 'levelTail string map gates run backwards')
    require(isinstance(tail.get('unprovenNames'), list) and isinstance(tail.get('olderVersionsUnresolved'), str), 'levelTail needs its open name rows')


def require_requires_sorting_rules(rules):
    require(isinstance(rules, dict) and SHA256_HEX.fullmatch(str(rules.get('source', {}).get('sha256'))), 'requiresSortingRules needs its verified source')
    for rule, fields in REQUIRES_SORTING_RULE_FIELDS.items():
        require(isinstance(rules.get(rule), dict) and all(isinstance(rules[rule].get(field), str) and rules[rule][field] for field in fields),
                f'requiresSortingRules {rule} needs {fields}')
    shader = rules['shader']
    require(isinstance(shader.get('sortingOutputBlending'), list) and shader['sortingOutputBlending'] and all(is_count(value) for value in shader['sortingOutputBlending'])
            and is_count(shader.get('opacityOutputBlending')), 'requiresSortingRules shader needs its output blending ordinals')


def require_material_sorting(rows):
    require(isinstance(rows, list) and rows, 'materialSorting must list materials')
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get('material'), str) and type(row.get('requiresSorting')) is bool,
                'every materialSorting row needs a material and a requiresSorting flag')
    materials = [row['material'].casefold() for row in rows]
    require(len(materials) == len(set(materials)), 'materialSorting repeats a material')


def validate_shared_sky_visibility_rules(document):
    require(isinstance(document, dict) and set(document) == DOCUMENT_FIELDS, f'fields must be {sorted(DOCUMENT_FIELDS)}')
    require(document['schemaVersion'] == SHARED_SKY_VISIBILITY_RULES_SCHEMA_VERSION and document['kind'] == SHARED_SKY_VISIBILITY_RULES_KIND,
            f'is not a shared-sky-visibility-rules v{SHARED_SKY_VISIBILITY_RULES_SCHEMA_VERSION} recipe')
    require(all(SHA256_HEX.fullmatch(str(document['sources'].get(name, {}).get('sha256'))) for name in SOURCE_NAMES), 'every source needs its sha256')
    require_level_tail(document['levelTail'])
    require_requires_sorting_rules(document['requiresSortingRules'])
    require_material_sorting(document['materialSorting'])
    return document


def load_shared_sky_visibility_rules(path):
    payload = Path(path).read_bytes()
    return {'path': SHARED_SKY_VISIBILITY_RULES_RELATIVE_PATH, 'sha256': hashlib.sha256(payload).hexdigest(),
            'document': validate_shared_sky_visibility_rules(json.loads(payload))}


@functools.cache
def read_shared_sky_visibility_rules():
    return load_shared_sky_visibility_rules(REPOSITORY_ROOT / SHARED_SKY_VISIBILITY_RULES_RELATIVE_PATH)


def level_tail_rules():
    return read_shared_sky_visibility_rules()['document']['levelTail']
