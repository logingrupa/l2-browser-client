from collections import namedtuple
from concurrent.futures import ProcessPoolExecutor

ItemUnitWorker = namedtuple('ItemUnitWorker', 'run preflight')
item_unit_worker = None


def initialize_item_unit_worker(run_factory, run_factory_arguments, preflight):
    global item_unit_worker
    item_unit_worker = ItemUnitWorker(run_factory(*run_factory_arguments), preflight)


def converted_unit_outcome(unit_key):
    item_unit_worker.preflight()
    return item_unit_worker.run.convert_unsealed_unit(item_unit_worker.run.units_by_key[unit_key])


def outcomes_converted_by_workers(unit_keys, worker_count, run_factory, run_factory_arguments, preflight):
    executor = ProcessPoolExecutor(max_workers=worker_count, initializer=initialize_item_unit_worker,
                                   initargs=(run_factory, run_factory_arguments, preflight))
    try:
        futures = [executor.submit(converted_unit_outcome, unit_key) for unit_key in unit_keys]
        return [future.result() for future in futures]
    finally:
        executor.shutdown(wait=True, cancel_futures=True)
