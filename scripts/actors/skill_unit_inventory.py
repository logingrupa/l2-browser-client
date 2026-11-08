from actors.actor_unit_inventory import census_row, conversion_unit, decoded_table_identity, decoded_table_rows
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


def skill_row_gap_reason(skill_rows, roots_by_key):
    if len(skill_rows) > 1:
        return f'skill-row-ambiguous:{len(skill_rows)}'
    description = skill_rows[0]['description']
    if not description:
        return NATIVE_SKILL_DISPATCH_REQUIRED_REASON
    return roots_by_key[skill_root_key(description)]['reason']


def skill_sound_unit(row_index, sound_row, package_census, table_identity):
    references = [sound_row[field] for field in REFERENCE_FIELDS if sound_row[field]]
    resolved = all(REFERENCE.fullmatch(reference) and package_census.sound_package_resolves(reference) for reference in references)
    return conversion_unit(f'{SKILL_SOUND_ROW_UNIT_KIND}:{row_index}', SKILL_SOUND_PART_NAME, SKILL_SOUND_ROW_UNIT_KIND,
                           None if resolved else SOUND_IDENTITY_UNRESOLVED_REASON, table_identity,
                           {'skillId': sound_row['skill_id'], 'level': sound_row['skill_level'], 'references': references})


def skill_units_and_rows(skillgrp, skillsoundgrp, package_census):
    skill_identity = decoded_table_identity(skillgrp)
    roots_by_key, skill_rows_by_identity = {}, {}
    for skill in decoded_table_rows(skillgrp):
        skill_rows_by_identity.setdefault((skill['skill_id'], skill['skill_level']), []).append(skill)
        description = skill['description']
        if description and skill_root_key(description) not in roots_by_key:
            roots_by_key[skill_root_key(description)] = skill_root_unit(description, package_census, skill_identity)
    rows = [census_row(f'skill:{skill_id}:{skill_level}', SKILL_PART_NAME, skill_row_gap_reason(skill_rows, roots_by_key), skill_identity)
            for (skill_id, skill_level), skill_rows in skill_rows_by_identity.items()]
    sound_identity = decoded_table_identity(skillsoundgrp)
    sound_units = [skill_sound_unit(row_index, sound_row, package_census, sound_identity)
                   for row_index, sound_row in enumerate(decoded_table_rows(skillsoundgrp))]
    return [*roots_by_key.values(), *sound_units], rows
