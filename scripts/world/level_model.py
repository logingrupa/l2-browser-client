from typing import NamedTuple

from native_catalog.ue2 import FormatError
from world.bsp_model_licensee_rules import read_bsp_model_licensee_rules
from world.bsp_reader_binding import PackageAdapter, reviewed_reader
from world.level_model_reference import read_level_model_reference
from world.reader_licensee_layouts import LEVEL_MODEL_READER, require_reviewed_reader_layout

INDEX_NONE = -1
LEAF_HULL_BOUND_WORDS = 6


class LevelModelLayoutError(FormatError):
    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason


class LevelModelRangeError(FormatError):
    def __init__(self, field, message):
        super().__init__(f'{field}: {message}')
        self.field = field


class LevelModel(NamedTuple):
    package: object
    adapter: object
    reader: object
    export: object
    binding: dict
    model: object
    checks: dict


def reviewed_level_model_layout(package_summary, filename):
    try:
        return require_reviewed_reader_layout(LEVEL_MODEL_READER, package_summary)
    except FormatError as error:
        raise LevelModelLayoutError(str(error), f'{filename} is outside the reviewed level-model reader layouts: {error}') from error


def require_index_or_none(value, size, field, node_index):
    if not (value == INDEX_NONE or 0 <= value < size):
        raise LevelModelRangeError(field, f'node {node_index} points at {value} outside {size} entries')


def leaf_hull_run_end(leaf_hulls, start, node_index):
    position = start
    while position < len(leaf_hulls) and leaf_hulls[position] >= 0:
        position += 1
    if position >= len(leaf_hulls):
        raise LevelModelRangeError('LeafHulls', f'run of node {node_index} from {start} has no negative terminator inside {len(leaf_hulls)} entries')
    if position + LEAF_HULL_BOUND_WORDS >= len(leaf_hulls):
        raise LevelModelRangeError('LeafHulls', f'run of node {node_index} from {start} ends without its {LEAF_HULL_BOUND_WORDS} bound words')
    return position


def require_level_model_ranges(model):
    for node_index, node in enumerate(model.nodes):
        require_index_or_none(node.i_render_bound, len(model.model_bounds), 'iRenderBound', node_index)
        require_index_or_none(node.i_collision_bound, len(model.leaf_hulls), 'iCollisionBound', node_index)
        if node.i_collision_bound != INDEX_NONE:
            leaf_hull_run_end(model.leaf_hulls, node.i_collision_bound, node_index)


def surface_reads_trailing_integer(licensee_version):
    return licensee_version >= read_bsp_model_licensee_rules()['document']['rules']['surfaceTrailingInteger']['minimumLicensee']


def read_model_body(adapter, reader_module, export):
    return reader_module._read_model(adapter, export, surface_reads_trailing_integer(adapter.licensee_version))


def read_level_model_without_layout_gate(package):
    adapter, reader = PackageAdapter(package), reviewed_reader()
    try:
        export, binding = read_level_model_reference(adapter, reader, read_bsp_model_licensee_rules()['document']['rules'])
        model = read_model_body(adapter, reader, export)
        checks = reader.validate_model(model)
    except ValueError as error:
        raise FormatError(f'{package.filename} Level.Model: {error}') from error
    require_level_model_ranges(model)
    return LevelModel(package, adapter, reader, export, binding, model, checks)


def read_level_model(package):
    reviewed_level_model_layout(package.summary, package.filename)
    return read_level_model_without_layout_gate(package)
