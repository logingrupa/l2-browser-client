import os
from pathlib import Path
import shutil

from native_store.identical_file_sharing import MAXIMUM_NAMES_PER_SHARED_FILE
from native_store.unit_ledger import nearest_existing_ancestor


def paths_are_on_one_volume(existing_path, destination_path):
    return os.stat(existing_path).st_dev == os.stat(nearest_existing_ancestor(Path(destination_path))).st_dev


def source_can_be_linked(source_path, destination_path):
    return paths_are_on_one_volume(source_path, destination_path) and os.stat(source_path).st_nlink < MAXIMUM_NAMES_PER_SHARED_FILE


def link_or_copy_file(source_path, destination_path):
    if source_can_be_linked(source_path, destination_path):
        os.link(source_path, destination_path)
    else:
        shutil.copyfile(source_path, destination_path)
