import hashlib

from actors.skill_dispatch_candidates import ANIMATION_NOTIFY_ROUTE, ANIMATION_NOTIFY_STAGE, read_strict_json_bytes, require
from actors.skill_dispatch_recipe_sources import (ANIMATION_NOTIFY_FACTS_FILE_NAME, ANIMATION_NOTIFY_REPLAY_RESULT_RELATIVE_PATH,
                                                  ANIMATION_NOTIFY_SHA256, client_relative_path, read_pinned_json, verified_facts_identity)

PROVEN_CONDITIONAL_BINDING_STATUS = 'proven-conditional-visual-binding'
INCOMPLETE_PLAYBACK_RECIPE_STATUS = 'incomplete'
ROUTE_FIELDS = ('npcId', 'mesh', 'animation', 'sequence', 'numFrames', 'authoredRate')
EFFECT_FIELDS = ('effectObject', 'notifyObject', 'notifyExportIndex', 'notifyTime', 'timeUnit', 'authoredProperties')
UNCLAIMED_FLAGS = ('R2StatusesChanged', 'livePlaybackClaimed', 'clientTreesWritten')


def notify_binding_record(binding):
    require(binding['stage'] == ANIMATION_NOTIFY_STAGE and binding['status'] == PROVEN_CONDITIONAL_BINDING_STATUS
            and binding['playbackRecipeStatus'] == INCOMPLETE_PLAYBACK_RECIPE_STATUS,
            f'animation notify binding {binding["skillId"]}/{binding["skillLevel"]} is not an incomplete conditional binding')
    return {'skillId': binding['skillId'], 'level': binding['skillLevel'], 'stage': binding['stage'], 'status': binding['status'],
            'playbackRecipeStatus': binding['playbackRecipeStatus'], 'conditions': binding['conditions'],
            'routes': [{**{field: route[field] for field in ROUTE_FIELDS},
                        'effects': [{field: effect[field] for field in EFFECT_FIELDS} for effect in route['effects']]}
                       for route in binding['routes']]}


def notify_class_records(source, bindings, lock):
    pins_by_object = {}
    for replay in source['packageIdentityReplay']:
        decoded_object, object_index = replay['decodedValues'].get('object'), replay['decodedValues'].get('objectIndex')
        if decoded_object and type(object_index) is int and object_index > 0:
            pins_by_object.setdefault(decoded_object, set()).add((client_relative_path(replay['file']), replay['fileSha256']))
    records = {}
    for binding in bindings:
        for route in binding['routes']:
            for effect in route['effects']:
                [(relative_path, package_sha256)] = pins_by_object.get(effect['effectObject'], [(None, None)])
                record = lock.record(relative_path) if relative_path else None
                require(record is not None and record['class'] == 'equal' and record['eSha256'] == package_sha256,
                        f'{effect["effectObject"]} has no lock-equal package pin in the animation notify replay')
                records[effect['effectObject']] = {'effectObject': effect['effectObject'], 'packageSha256': package_sha256,
                                                   'nativeSuperClass': effect['nativeSuperClass']}
    return [records[name] for name in sorted(records)]


def notify_verification(verification_folder):
    result_payload = (verification_folder / ANIMATION_NOTIFY_REPLAY_RESULT_RELATIVE_PATH).read_bytes()
    result = read_strict_json_bytes(result_payload, 'animation notify replay result')
    require(all(file_check['eMatchesLockE'] and file_check['lockClass'] == 'equal' for file_check in result['files'].values()),
            'the animation notify replay read a file that is not lock-equal')
    instructions, data = result['instructions'], result['data']
    require(instructions['checked'] == instructions['matched'] and data['checked'] == data['matched'],
            'the animation notify replay records a mismatch')
    return {**verified_facts_identity(verification_folder / ANIMATION_NOTIFY_FACTS_FILE_NAME),
            'instructions': {'checked': instructions['checked'], 'matched': instructions['matched']},
            'dataRows': {'checked': data['checked'], 'matched': data['matched']},
            'replayResultSha256': hashlib.sha256(result_payload).hexdigest()}


def animation_notify_section(source_path, verification_folder, lock, engine_sha256, dispatch_rows, single_empty_keys, unresolved_row_count):
    source = read_pinned_json(source_path, ANIMATION_NOTIFY_SHA256, 'animation notify bindings')
    require(source['source']['sha256'] == engine_sha256, 'the animation notify bindings name another engine')
    require(all(source[flag] is False for flag in UNCLAIMED_FLAGS), 'the animation notify bindings claim a status change, playback or a write')
    rows = [(binding['skillId'], binding['skillLevel']) for binding in source['bindings']]
    require(len(set(rows)) == len(rows) == source['newVisualSkillRowBindings'], 'animation notify rows repeat or miss a binding')
    require(source['baselineMissingRows'] == unresolved_row_count
            and source['remainingRowsWithoutNewVisualBinding'] == unresolved_row_count - len(rows),
            'animation notify row counts differ from the unresolved dispatch rows')
    require(not set(rows) & dispatch_rows and set(rows) <= single_empty_keys,
            'an animation notify row is a dispatch candidate row or not one empty-description skillgrp row')
    bindings = [notify_binding_record(binding) for binding in sorted(source['bindings'], key=lambda binding: (binding['skillId'], binding['skillLevel']))]
    return {'sourceSha256': ANIMATION_NOTIFY_SHA256, 'route': ANIMATION_NOTIFY_ROUTE, 'verification': notify_verification(verification_folder),
            'classes': notify_class_records(source, source['bindings'], lock), 'bindings': bindings}
