import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

import argparse
import json

from actors.actor_unit_inventory import NO_MESH_IN_ROW_REASON
from actors.character_conversion import PADDING_STATUS, CharacterConversionRun, read_character_sources
from actors.character_requests import (BODY_MESH_GROUP, CHARGRP_ROW_COLLECTION, CLASSINFO_ACTOR_CLASS_FIELD, CLASSINFO_CHARGRP_INDEX_FIELD,
                                       CLASSINFO_TABLE_NAME, GAP_STATUS, HAIRGRP_TABLE_NAME, HELMETGRP_TABLE_NAME, character_key,
                                       classinfo_class_resolution, is_padding_row, manifest_record_fields)
from data.hair_table_adapter import HAIR_TABLE_FIELD_PROOF
from native_assets import UMODEL, Converter
from native_catalog.tables import decode_table
from native_store.store_paths import REPOSITORY_ROOT, lane_store_root, lane_work_root
from reference_client_guard import require_reference_client

CHARACTER_LANE_NAME = 'actors'
CONVERTER_WORK_FOLDER = 'converter'
CHARACTER_CENSUS_DESCRIPTION = ('Write docs/parts/player-characters/character-census.json from the sealed character units of the actors lane. '
                                '--check compares and writes nothing.')


class CharacterCensusError(ValueError):
    pass

CHARACTER_CENSUS_RELATIVE_PATH = 'docs/parts/player-characters/character-census.json'
CHARACTER_CENSUS_SCHEMA_VERSION = 1
CHARACTER_BATCH_NAME = 'characters'
RESOLVED_STATUS, PENDING_STATUS, CONVERTED_STATUS, WRITTEN_STATUS = 'resolved', 'pending', 'converted', 'written'
LAYOUT_CENSUS_FIELDS = ('status', 'reason', 'joinField', 'candidateCount')


def census_collision(profile_fields):
    collision = profile_fields['collision']
    if collision is None:
        return {'status': GAP_STATUS, 'reason': profile_fields['reason'], 'radiusClass': None, 'heightClass': None}
    reason = next((entry['reason'] for entry in collision.values() if 'reason' in entry), None)
    return {'status': GAP_STATUS if reason else RESOLVED_STATUS, 'reason': reason,
            'radiusClass': collision['collisionRadius'].get('class'), 'heightClass': collision['collisionHeight'].get('class')}


def padding_census_row(row_index, chargrp_row):
    return {'chargrpIndex': row_index, 'key': None, 'padding': True, 'model': None, 'parts': [], 'hair': None, 'helmet': None,
            'collision': None, 'gaps': [{'field': field, 'reason': NO_MESH_IN_ROW_REASON} for field in chargrp_row[BODY_MESH_GROUP]],
            'profile': None}


def character_census_row(row_index, receipt):
    if receipt is None:
        return {'chargrpIndex': row_index, 'key': character_key(row_index), 'padding': False, 'model': PENDING_STATUS, 'parts': [],
                'hair': None, 'helmet': None, 'collision': None, 'gaps': [], 'profile': PENDING_STATUS}
    generated, gap_rows = receipt['config']['generated'], receipt['gapRows']
    model_gaps = [] if receipt['outputs'] else [{'field': 'model', 'reason': gap_rows[0]['reason']}]
    profile = generated['profileFields']
    return {'chargrpIndex': row_index, 'key': character_key(row_index), 'padding': False,
            'model': CONVERTED_STATUS if receipt['outputs'] else GAP_STATUS, 'parts': generated['parts'],
            'hair': {field: generated['hair'][field] for field in LAYOUT_CENSUS_FIELDS},
            'helmet': {field: generated['helmet'][field] for field in LAYOUT_CENSUS_FIELDS},
            'collision': census_collision(profile),
            'gaps': model_gaps + generated['gaps'] + ([{'field': 'profile', 'reason': profile['reason']}] if profile['reason'] else []),
            'profile': GAP_STATUS if profile['reason'] else WRITTEN_STATUS}


def census_counts(rows):
    characters = [row for row in rows if not row['padding']]
    return {'rows': len(rows), 'padding': len(rows) - len(characters), 'characters': len(characters),
            'modelsConverted': sum(1 for row in characters if row['model'] == CONVERTED_STATUS),
            'profilesWritten': sum(1 for row in characters if row['profile'] == WRITTEN_STATUS),
            'gapKeys': sum(1 for row in characters if row['profile'] == GAP_STATUS),
            'pendingKeys': sum(1 for row in characters if row['profile'] == PENDING_STATUS)}


def current_character_receipt(run, row_index):
    key = character_key(row_index)
    _, _, _, fingerprint = run.unit_work(row_index)
    return run.ledger.sealed_receipt(key) if run.ledger.is_sealed(key, fingerprint) else None


def character_census(run):
    chargrp_rows = run.sources.chargrp['data'][CHARGRP_ROW_COLLECTION]
    rows = [padding_census_row(index, row) if is_padding_row(row) else character_census_row(index, current_character_receipt(run, index))
            for index, row in enumerate(chargrp_rows)]
    sources = {table: manifest['sourceSha256'] if manifest else None for table, manifest in
               ((CLASSINFO_TABLE_NAME, run.sources.classinfo), (HAIRGRP_TABLE_NAME, run.sources.hairgrp), (HELMETGRP_TABLE_NAME, run.sources.helmetgrp))}
    return {'schemaVersion': CHARACTER_CENSUS_SCHEMA_VERSION, 'chargrpSourceSha256': run.sources.chargrp['sourceSha256'],
            'classinfoSourceSha256': sources[CLASSINFO_TABLE_NAME], 'hairgrpSourceSha256': sources[HAIRGRP_TABLE_NAME],
            'helmetgrpSourceSha256': sources[HELMETGRP_TABLE_NAME], 'hairFieldProof': HAIR_TABLE_FIELD_PROOF,
            'classJoin': {'requiredFields': [CLASSINFO_CHARGRP_INDEX_FIELD, CLASSINFO_ACTOR_CLASS_FIELD],
                          'decodedFields': classinfo_class_resolution(run.sources.classinfo, 0)['evidence']['fields'],
                          'classSources': {'path': run.sources.class_sources['path'], 'resultSha256': run.sources.class_sources['sha256'],
                                           'verdict': run.sources.class_sources['document']['verdict']}},
            'layoutRecordFields': {HAIRGRP_TABLE_NAME: manifest_record_fields(run.sources.hairgrp),
                                   HELMETGRP_TABLE_NAME: manifest_record_fields(run.sources.helmetgrp)},
            'animationFamilies': {'path': run.sources.animation_families['path'], 'sha256': run.sources.animation_families['sha256']},
            'counts': census_counts(rows), 'rows': rows}


def character_census_bytes(run):
    return (json.dumps(character_census(run), indent=1, sort_keys=True, ensure_ascii=True) + '\n').encode('ascii')


def write_character_census(run):
    path = run.project_root / CHARACTER_CENSUS_RELATIVE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(character_census_bytes(run))
    return path


def check_character_census(run):
    path = run.project_root / CHARACTER_CENSUS_RELATIVE_PATH
    if not (path.is_file() and path.read_bytes() == character_census_bytes(run)):
        raise CharacterCensusError(f'{CHARACTER_CENSUS_RELATIVE_PATH} differs from the census of the sealed character units; rerun without --check')
    return path


def run_character_batch(run, limit, preflight):
    outcomes, converted = [], 0
    for row_index in range(len(run.sources.chargrp['data'][CHARGRP_ROW_COLLECTION])):
        if converted >= limit:
            break
        preflight()
        outcome = run.convert(row_index)
        converted += 0 if outcome['cacheHit'] or outcome['status'] == PADDING_STATUS else 1
        outcomes.append(outcome)
    return outcomes


def run_character_conversion(project_root, client_access, converter, output_root, decode_table, arguments, preflight):
    work_root = lane_work_root(project_root, CHARACTER_LANE_NAME)
    sources = read_character_sources(project_root, client_access.root, decode_table, work_root / 'class-defaults')
    run = CharacterConversionRun(project_root, client_access, converter, work_root, output_root, sources)
    if arguments.batch == CHARACTER_BATCH_NAME:
        outcomes = run_character_batch(run, arguments.limit, preflight)
        write_character_census(run)
    else:
        outcomes = [run.convert(arguments.character)]
    return outcomes


def lane_character_run(project_root, client_access):
    work_root, store_root = lane_work_root(project_root, CHARACTER_LANE_NAME), lane_store_root(project_root, CHARACTER_LANE_NAME)
    converter = Converter(client_access.root, store_root.parent / CONVERTER_WORK_FOLDER, UMODEL)
    sources = read_character_sources(project_root, client_access.root, decode_table, work_root / 'class-defaults')
    return CharacterConversionRun(project_root, client_access, converter, work_root, store_root, sources)


def main(argv=None):
    parser = argparse.ArgumentParser(description=CHARACTER_CENSUS_DESCRIPTION)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    arguments = parser.parse_args(argv)
    try:
        run = lane_character_run(REPOSITORY_ROOT, require_reference_client(arguments.client))
        path = check_character_census(run) if arguments.check else write_character_census(run)
    except (OSError, ValueError, KeyError) as error:
        print(f'Character census failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps({'census': path.relative_to(REPOSITORY_ROOT).as_posix(), 'counts': json.loads(path.read_bytes())['counts']}, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
