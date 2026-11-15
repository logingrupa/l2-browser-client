from collections import namedtuple
from concurrent.futures import ProcessPoolExecutor

from actors.item_conversion import ItemConversionRun, read_item_sources
from native_assets import Converter
from native_catalog.tables import decode_table
from native_store.interprocess_lock import hold_lane_in_use_part_until_process_end
from reference_client_guard import require_reference_client

ItemUnitWorker = namedtuple('ItemUnitWorker', 'run preflight')
item_unit_worker = None


class ItemUnitWorkerError(ValueError):
    pass


def item_worker_run(project_root, client_root, converter_output_root, umodel_path, ledger_root, store_root):
    client_access = require_reference_client(client_root)
    converter = Converter(client_access.root, converter_output_root, umodel_path)
    sources = read_item_sources(project_root, client_access.root, decode_table)
    return ItemConversionRun(project_root, client_access, converter, ledger_root, store_root, sources)


def initialize_item_unit_worker(run_factory, run_factory_arguments, preflight):
    global item_unit_worker
    item_unit_worker = ItemUnitWorker(run_factory(*run_factory_arguments), preflight)
    hold_lane_in_use_part_until_process_end(item_unit_worker.run.ledger.work_root)


def converted_unit_outcome(unit_key):
    item_unit_worker.preflight()
    if unit_key not in item_unit_worker.run.units_by_key:
        raise ItemUnitWorkerError(f'the run of this item unit worker holds no unit {unit_key}')
    return item_unit_worker.run.convert_unsealed_unit(item_unit_worker.run.units_by_key[unit_key])


def outcomes_converted_by_workers(unit_keys, worker_count, run_factory, run_factory_arguments, preflight):
    executor = ProcessPoolExecutor(max_workers=worker_count, initializer=initialize_item_unit_worker,
                                   initargs=(run_factory, run_factory_arguments, preflight))
    try:
        futures = [executor.submit(converted_unit_outcome, unit_key) for unit_key in unit_keys]
        return [future.result() for future in futures]
    finally:
        executor.shutdown(wait=True, cancel_futures=True)
