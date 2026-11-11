from native_store.unit_ledger import locked_input_records
from world.raw_map_step import tile_map_path


def receipt_with_current_version_config_and_locked_inputs(ledger, unit_key, tile_id, config):
    receipt = ledger.sealed_receipt(unit_key)
    if receipt is None or receipt['algorithmVersion'] != ledger.algorithm_version or receipt['config'] != config:
        return None
    paths = [record['path'] for record in receipt['inputs']]
    if tile_map_path(tile_id) not in paths or locked_input_records(paths) != receipt['inputs']:
        return None
    return receipt
