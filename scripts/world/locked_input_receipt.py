from native_store.unit_ledger import locked_input_records
from world.raw_map_step import tile_map_path


def receipt_with_current_version_config_and_locked_map_inputs(ledger, unit_key, map_path, config):
    receipt = ledger.sealed_receipt(unit_key)
    if receipt is None or not ledger.has_current_versions(receipt) or receipt['config'] != config:
        return None
    paths = [record['path'] for record in receipt['inputs']]
    if map_path not in paths or locked_input_records(paths) != receipt['inputs']:
        return None
    return receipt


def receipt_with_current_version_config_and_locked_inputs(ledger, unit_key, tile_id, config):
    return receipt_with_current_version_config_and_locked_map_inputs(ledger, unit_key, tile_map_path(tile_id), config)
