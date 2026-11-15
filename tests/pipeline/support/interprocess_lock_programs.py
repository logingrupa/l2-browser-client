import os
from pathlib import Path

from native_store.interprocess_lock import hold_lane_in_use_part_until_process_end, interprocess_lock, lane_batch_lock, lane_sharing_lock
from support.item_unit_worker_runs import wait_until_path_exists

EVENT_LOG_NAME = 'events.log'
EVENT_MARKER_SUFFIX = '.reached'


def event_log_path(events_folder):
    return Path(events_folder) / EVENT_LOG_NAME


def event_marker_path(events_folder, event):
    return Path(events_folder) / (event.replace(' ', '-') + EVENT_MARKER_SUFFIX)


def record_event(events_folder, event):
    with open(event_log_path(events_folder), 'a', encoding='utf-8') as event_log:
        event_log.write(event + '\n')
    event_marker_path(events_folder, event).write_bytes(b'')


def recorded_events(events_folder):
    return event_log_path(events_folder).read_text(encoding='utf-8').splitlines()


def hold_the_lock_until_released(lock_folder, key, events_folder, process_name, release_path):
    with interprocess_lock(Path(lock_folder), key):
        record_event(events_folder, process_name + ' entered')
        wait_until_path_exists(Path(release_path))
        record_event(events_folder, process_name + ' leaving')


def announce_then_enter_the_lock(lock_folder, key, events_folder, process_name):
    record_event(events_folder, process_name + ' waiting')
    with interprocess_lock(Path(lock_folder), key):
        record_event(events_folder, process_name + ' entered')


def exit_while_holding_the_lock(lock_folder, key, events_folder, process_name):
    with interprocess_lock(Path(lock_folder), key):
        record_event(events_folder, process_name + ' entered')
        os._exit(0)


def hold_the_lane_batch_parts_until_released(lane_work_root, events_folder, process_name, release_path):
    with lane_batch_lock(Path(lane_work_root)):
        record_event(events_folder, process_name + ' entered')
        wait_until_path_exists(Path(release_path))


def hold_the_lane_in_use_part_until_released(lane_work_root, events_folder, process_name, release_path):
    hold_lane_in_use_part_until_process_end(Path(lane_work_root))
    record_event(events_folder, process_name + ' entered')
    wait_until_path_exists(Path(release_path))


def hold_the_whole_lane_until_released(lane_work_root, events_folder, process_name, release_path):
    with lane_sharing_lock(Path(lane_work_root)):
        record_event(events_folder, process_name + ' entered')
        wait_until_path_exists(Path(release_path))


LOCK_PROGRAMS = {'hold-until-released': hold_the_lock_until_released, 'announce-then-enter': announce_then_enter_the_lock,
                 'exit-while-holding': exit_while_holding_the_lock, 'hold-lane-batch-parts': hold_the_lane_batch_parts_until_released,
                 'hold-lane-in-use-part': hold_the_lane_in_use_part_until_released, 'hold-whole-lane': hold_the_whole_lane_until_released}


def run_lock_program(arguments):
    LOCK_PROGRAMS[arguments[0]](*arguments[1:])
