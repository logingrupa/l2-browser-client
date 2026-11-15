from actors.actor_unit_inventory import census_row, conversion_unit, decoded_table_identity, decoded_table_rows
from actors.skill_dispatch_candidates import (SKILL_DISPATCH_CANDIDATE_RUNTIME_UNRESOLVED_REASON, SKILL_DISPATCH_CLASS_UNIT_KIND,
                                              animation_notify_candidates_by_skill_key, candidate_class_records, dispatch_candidates_by_skill_key,
                                              skill_dispatch_class_key)
from native_assets_lib.skill_audio_bundle import REFERENCE, REFERENCE_FIELDS

SKILL_PART_NAME = 'skills-effects'
SKILL_SOUND_PART_NAME = 'audio'
SKILL_ROOT_UNIT_KIND = 'skill-root'
SKILL_SOUND_ROW_UNIT_KIND = 'skill-sound-row'
NATIVE_SKILL_DISPATCH_REQUIRED_REASON = 'native-skill-dispatch-required'
SOUND_IDENTITY_UNRESOLVED_REASON = 'sound-identity-unresolved'


def skill_root_key(description):
    return f'{SKILL_ROOT_UNIT_KIND}:{description}'


def skill_root_unit(description, package_census, table_identity):
    return conversion_unit(skill_root_key(description), SKILL_PART_NAME, SKILL_ROOT_UNIT_KIND, package_census.effect_gap_reason(description),
                           package_census.effect_source_identity(description) or table_identity, {'description': description})


def skill_dispatch_class_unit(class_record, package_census, table_identity):
    effect_object = class_record['effectObject']
    return conversion_unit(skill_dispatch_class_key(effect_object), SKILL_PART_NAME, SKILL_DISPATCH_CLASS_UNIT_KIND,
                           package_census.effect_gap_reason(effect_object), package_census.effect_source_identity(effect_object) or table_identity,
                           {'effectObject': effect_object, 'packageSha256': class_record['packageSha256']})


def dispatch_candidate_skill_keys(dispatch_candidates):
    return frozenset(dispatch_candidates_by_skill_key(dispatch_candidates)) | frozenset(animation_notify_candidates_by_skill_key(dispatch_candidates))


def skill_row_gap_reason(skill_rows, roots_by_key, is_dispatch_candidate):
    if len(skill_rows) > 1:
        return f'skill-row-ambiguous:{len(skill_rows)}'
    description = skill_rows[0]['description']
    if not description:
        return SKILL_DISPATCH_CANDIDATE_RUNTIME_UNRESOLVED_REASON if is_dispatch_candidate else NATIVE_SKILL_DISPATCH_REQUIRED_REASON
    return roots_by_key[skill_root_key(description)]['reason']


def skill_sound_unit(row_index, sound_row, package_census, table_identity):
    references = [sound_row[field] for field in REFERENCE_FIELDS if sound_row[field]]
    resolved = all(REFERENCE.fullmatch(reference) and package_census.sound_package_resolves(reference) for reference in references)
    return conversion_unit(f'{SKILL_SOUND_ROW_UNIT_KIND}:{row_index}', SKILL_SOUND_PART_NAME, SKILL_SOUND_ROW_UNIT_KIND,
                           None if resolved else SOUND_IDENTITY_UNRESOLVED_REASON, table_identity,
                           {'skillId': sound_row['skill_id'], 'level': sound_row['skill_level'], 'references': references})


def skill_units_and_rows(skillgrp, skillsoundgrp, package_census, dispatch_candidates):
    skill_identity = decoded_table_identity(skillgrp)
    candidate_keys = dispatch_candidate_skill_keys(dispatch_candidates)
    roots_by_key, skill_rows_by_identity = {}, {}
    for skill in decoded_table_rows(skillgrp):
        skill_rows_by_identity.setdefault((skill['skill_id'], skill['skill_level']), []).append(skill)
        description = skill['description']
        if description and skill_root_key(description) not in roots_by_key:
            roots_by_key[skill_root_key(description)] = skill_root_unit(description, package_census, skill_identity)
    rows = [census_row(f'skill:{skill_id}:{skill_level}', SKILL_PART_NAME,
                       skill_row_gap_reason(skill_rows, roots_by_key, (skill_id, skill_level) in candidate_keys), skill_identity)
            for (skill_id, skill_level), skill_rows in skill_rows_by_identity.items()]
    class_units = [skill_dispatch_class_unit(record, package_census, skill_identity) for record in candidate_class_records(dispatch_candidates)]
    sound_identity = decoded_table_identity(skillsoundgrp)
    sound_units = [skill_sound_unit(row_index, sound_row, package_census, sound_identity)
                   for row_index, sound_row in enumerate(decoded_table_rows(skillsoundgrp))]
    return [*roots_by_key.values(), *class_units, *sound_units], rows
