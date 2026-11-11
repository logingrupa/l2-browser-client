import contextlib
import hashlib
from unittest.mock import patch

from native_store.store_paths import lane_work_root
from native_store.unit_ledger import UnitLedger, locked_input_records
from world import tile_music
from world.raw_map_step import (PRODUCTS_FOLDER_NAME, RAW_MAP_STEP_ALGORITHM_VERSION, RAW_STEP_NAME, raw_map_recipe, read_tile_map_lock_record,
                                tile_map_path, tile_step_row, tile_unit_key)
from world.tile_census import WORLD_LANE_NAME

LOCKED_TILE_ID = '20_15'
SYNTHETIC_PRODUCT_NAME = 'product.json'
SYNTHETIC_PRODUCT_BYTES = b'[]'
SYNTHETIC_OBJECT_GAP_REASON = 'decode-failed:synthetic unreadable object'


def seal_unit(project_root, step, algorithm_version, unit_key, config, inputs, gap_rows=()):
    ledger = UnitLedger(lane_work_root(project_root, WORLD_LANE_NAME), step, algorithm_version)
    fingerprint = ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
    products_directory = ledger.begin(unit_key, fingerprint) / PRODUCTS_FOLDER_NAME
    products_directory.mkdir()
    product_path = products_directory / SYNTHETIC_PRODUCT_NAME
    product_path.write_bytes(SYNTHETIC_PRODUCT_BYTES)
    output = {'path': product_path.relative_to(ledger.lane_folder).as_posix(), 'sha256': hashlib.sha256(SYNTHETIC_PRODUCT_BYTES).hexdigest(),
              'bytes': len(SYNTHETIC_PRODUCT_BYTES)}
    ledger.seal(unit_key, fingerprint, {'config': config, 'inputs': inputs, 'outputs': [output], 'gapRows': list(gap_rows)})
    return fingerprint


def tile_map_inputs(tile_id):
    return locked_input_records([tile_map_path(tile_id)])


def seal_raw_unit(project_root, tile_id):
    recipe = raw_map_recipe(tile_id, read_tile_map_lock_record(tile_id))
    return seal_unit(project_root, RAW_STEP_NAME, RAW_MAP_STEP_ALGORITHM_VERSION, tile_unit_key(tile_id), recipe, tile_map_inputs(tile_id))


def object_gap_rows(tile_id, step, count):
    source_identity = {'path': tile_map_path(tile_id), 'sha256': read_tile_map_lock_record(tile_id)['eSha256']}
    return [tile_step_row(tile_id, step, 'gap', SYNTHETIC_OBJECT_GAP_REASON, {**source_identity, 'object': f'Synthetic.Object{index}'},
                          f'work/tile__{tile_id}/{step}/receipt.json')
            for index in range(count)]


@contextlib.contextmanager
def unpinned_music_encoder():
    with patch.object(tile_music.shutil, 'which', return_value=None):
        yield
