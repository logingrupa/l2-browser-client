import json

from actors.actor_unit_inventory import NO_MESH_IN_ROW_REASON
from actors.character_conversion import PADDING_STATUS, CharacterConversionRun, read_character_sources
from actors.character_requests import (BODY_MESH_GROUP, CHARGRP_ROW_COLLECTION, CLASSINFO_ACTOR_CLASS_FIELD, CLASSINFO_CHARGRP_INDEX_FIELD,
                                       CLASSINFO_TABLE_NAME, GAP_STATUS, HAIRGRP_TABLE_NAME, HELMETGRP_TABLE_NAME, character_key,
                                       is_padding_row, manifest_record_fields, resolve_character_actor_class)
from data.hair_table_adapter import HAIR_TABLE_FIELD_PROOF
from native_store.store_paths import lane_work_root

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
                          'decodedFields': resolve_character_actor_class(run.sources.classinfo, 0)['evidence']['fields']},
            'layoutRecordFields': {HAIRGRP_TABLE_NAME: manifest_record_fields(run.sources.hairgrp),
                                   HELMETGRP_TABLE_NAME: manifest_record_fields(run.sources.helmetgrp)},
            'counts': census_counts(rows), 'rows': rows}


def write_character_census(run):
    path = run.project_root / CHARACTER_CENSUS_RELATIVE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((json.dumps(character_census(run), indent=1, sort_keys=True, ensure_ascii=True) + '\n').encode('ascii'))
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
    work_root = lane_work_root(project_root, 'actors')
    sources = read_character_sources(project_root, client_access.root, decode_table, work_root / 'class-defaults')
    run = CharacterConversionRun(project_root, client_access, converter, work_root, output_root, sources)
    if arguments.batch == CHARACTER_BATCH_NAME:
        outcomes = run_character_batch(run, arguments.limit, preflight)
        write_character_census(run)
    else:
        outcomes = [run.convert(arguments.character)]
    return outcomes
