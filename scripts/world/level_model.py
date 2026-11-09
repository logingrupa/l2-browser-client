from typing import NamedTuple

from native_catalog.ue2 import FormatError
from world.bsp_reader_binding import PackageAdapter, reviewed_reader

REVIEWED_LEVEL_MODEL_VERSION = 123
REVIEWED_LEVEL_MODEL_LICENSEE = 28
SURFACE_LIGHTMAP_INDEX_LAYOUT = True
INDEX_NONE = -1
LEAF_HULL_BOUND_WORDS = 6
SKY_ZONE_CLASS = 'Engine.SkyZoneInfo'


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


def require_reviewed_level_model_layout(package):
    version, licensee = package.summary['version'], package.summary['licenseeVersion']
    if version != REVIEWED_LEVEL_MODEL_VERSION:
        raise LevelModelLayoutError(f'map-version-unsupported:{version}',
                                    f'{package.filename} version {version} is outside the vendored reader layout {REVIEWED_LEVEL_MODEL_VERSION}')
    if licensee != REVIEWED_LEVEL_MODEL_LICENSEE:
        raise LevelModelLayoutError(f'map-licensee-unsupported:{version}/{licensee}',
                                    f'{package.filename} licensee {licensee} is outside the vendored reader layout {REVIEWED_LEVEL_MODEL_LICENSEE}')


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


def read_level_model(package):
    require_reviewed_level_model_layout(package)
    adapter, reader = PackageAdapter(package), reviewed_reader()
    try:
        export, binding = reader.level_model_binding(adapter)
        model = reader._read_model(adapter, export, SURFACE_LIGHTMAP_INDEX_LAYOUT)
        checks = reader.validate_model(model)
    except ValueError as error:
        raise FormatError(f'{package.filename} Level.Model: {error}') from error
    require_level_model_ranges(model)
    return LevelModel(package, adapter, reader, export, binding, model, checks)


def zone_actor_export(package, zone_actor_reference):
    if zone_actor_reference <= 0 or zone_actor_reference > len(package.exports):
        return None
    return package.exports[zone_actor_reference - 1]


def sky_zone_indices(package, model):
    indices = set()
    for zone_index, zone in enumerate(model.zones):
        actor = zone_actor_export(package, zone[0])
        if actor is not None and actor['classObject'] == SKY_ZONE_CLASS:
            indices.add(zone_index)
    return frozenset(indices)
