import functools
import hashlib
import json
from pathlib import Path
import re

from native_store.store_paths import REPOSITORY_ROOT

UNVERIFIED_LEVEL_TAILS_RELATIVE_PATH = 'recipes/world/unverified-level-tails.json'
UNVERIFIED_LEVEL_TAILS_KIND = 'unverified-level-tails'
DOCUMENT_FIELDS = {'schemaVersion', 'kind', 'tails'}
TAIL_FIELDS = {'packageVersion', 'licenseeVersion', 'package', 'lockSha256', 'remainingTailBytes', 'remainingTailSHA256'}
SHA256_HEX = re.compile(r'[0-9a-f]{64}')


class UnverifiedLevelTailsError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise UnverifiedLevelTailsError(f'{UNVERIFIED_LEVEL_TAILS_RELATIVE_PATH}: {message}')


def is_count(value):
    return type(value) is int and value >= 0


def require_tail(tail):
    require(isinstance(tail, dict) and set(tail) == TAIL_FIELDS, f'a tail must hold exactly {sorted(TAIL_FIELDS)}')
    require(is_count(tail['packageVersion']) and is_count(tail['licenseeVersion']), 'a tail needs its package and licensee versions')
    require(isinstance(tail['package'], str) and tail['package'].startswith('maps/'), 'a tail needs its maps/ package path')
    require(is_count(tail['remainingTailBytes']), 'a tail needs its byte count')
    for field in ('lockSha256', 'remainingTailSHA256'):
        require(isinstance(tail[field], str) and SHA256_HEX.fullmatch(tail[field]) is not None, f'a tail needs its {field}')


def validate_unverified_level_tails_document(document):
    require(isinstance(document, dict) and set(document) == DOCUMENT_FIELDS, f'fields must be {sorted(DOCUMENT_FIELDS)}')
    require(document['schemaVersion'] == 1 and document['kind'] == UNVERIFIED_LEVEL_TAILS_KIND, 'is not an unverified-level-tails v1 recipe')
    require(isinstance(document['tails'], list), 'tails must be a list')
    for tail in document['tails']:
        require_tail(tail)
    pairs = [(tail['packageVersion'], tail['licenseeVersion']) for tail in document['tails']]
    require(len(pairs) == len(set(pairs)), 'repeats a package and licensee version pair')
    return document


def load_unverified_level_tails(path):
    payload = Path(path).read_bytes()
    return {'path': UNVERIFIED_LEVEL_TAILS_RELATIVE_PATH, 'sha256': hashlib.sha256(payload).hexdigest(),
            'document': validate_unverified_level_tails_document(json.loads(payload))}


@functools.cache
def read_unverified_level_tails():
    return load_unverified_level_tails(REPOSITORY_ROOT / UNVERIFIED_LEVEL_TAILS_RELATIVE_PATH)


def reviewed_unverified_level_tail_bytes(version, licensee_version):
    tails = [tail for tail in read_unverified_level_tails()['document']['tails']
             if (tail['packageVersion'], tail['licenseeVersion']) == (version, licensee_version)]
    require(len(tails) == 1, f'reviews no Level tail for {version}/{licensee_version}')
    return tails[0]['remainingTailBytes']


def unverified_level_tail_entry(level_model_fixture):
    binding = level_model_fixture['levelBinding']
    return {'packageVersion': level_model_fixture['packageVersion'], 'licenseeVersion': level_model_fixture['licenseeVersion'],
            'package': level_model_fixture['package'], 'lockSha256': level_model_fixture['lockSha256'],
            'remainingTailBytes': binding['remainingTailBytes'], 'remainingTailSHA256': binding['remainingTailSHA256']}


def write_unverified_level_tail(project_root, level_model_fixture):
    path = Path(project_root) / UNVERIFIED_LEVEL_TAILS_RELATIVE_PATH
    entry = unverified_level_tail_entry(level_model_fixture)
    pair = (entry['packageVersion'], entry['licenseeVersion'])
    existing = validate_unverified_level_tails_document(json.loads(path.read_bytes()))['tails'] if path.is_file() else []
    tails = sorted([*(tail for tail in existing if (tail['packageVersion'], tail['licenseeVersion']) != pair), entry],
                   key=lambda tail: (tail['packageVersion'], tail['licenseeVersion']))
    document = validate_unverified_level_tails_document({'schemaVersion': 1, 'kind': UNVERIFIED_LEVEL_TAILS_KIND, 'tails': tails})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=1) + '\n', encoding='utf-8')
