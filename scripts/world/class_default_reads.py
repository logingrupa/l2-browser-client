import copy
from pathlib import Path

from native_assets_lib.class_defaults import (CLASS_DEFAULT_CACHE_FOLDER_NAME, ClassDefaultError, cached_class_chain,
                                              read_class_defaults_with_provenance)
from native_assets_lib.material_program import material_graph_sha256, read_material_class_defaults
from native_store.interprocess_lock import interprocess_lock, lane_lock_folder

CLASS_DEFAULT_LOCK_KEY_PREFIX = 'class-defaults:'
VALUES_READ_KIND = 'values'
CHAIN_READ_KIND = 'chain'
MATERIAL_READ_KIND = 'material'
kept_answers_by_read = {}
kept_refusal_arguments_by_read = {}


def kept_read(work_root, class_scripts, read_identity, read):
    cache_folder = (Path(work_root) / CLASS_DEFAULT_CACHE_FOLDER_NAME).resolve()
    kept_key = (cache_folder, class_scripts.client_root, read_identity)
    if kept_key in kept_refusal_arguments_by_read:
        raise ClassDefaultError(*kept_refusal_arguments_by_read[kept_key])
    if kept_key not in kept_answers_by_read:
        with interprocess_lock(lane_lock_folder(work_root), CLASS_DEFAULT_LOCK_KEY_PREFIX + cache_folder.as_posix()):
            try:
                kept_answers_by_read[kept_key] = read()
            except ClassDefaultError as refusal:
                kept_refusal_arguments_by_read[kept_key] = refusal.args
                raise
    return copy.deepcopy(kept_answers_by_read[kept_key])


def kept_class_default_values(class_name, fields, work_root, class_scripts):
    field_names = tuple(fields)
    return kept_read(work_root, class_scripts, (VALUES_READ_KIND, class_name, field_names),
                     lambda: read_class_defaults_with_provenance(class_name, list(field_names), work_root, class_scripts))


def kept_class_chain(class_name, work_root, class_scripts):
    return kept_read(work_root, class_scripts, (CHAIN_READ_KIND, class_name), lambda: cached_class_chain(class_name, work_root, class_scripts))


def kept_material_class_defaults(graph, work_root, class_scripts):
    return kept_read(work_root, class_scripts, (MATERIAL_READ_KIND, material_graph_sha256(graph)),
                     lambda: read_material_class_defaults(graph, work_root, class_scripts))
