import hashlib
from types import SimpleNamespace
from unittest import mock

from support.level_model_fixture import build_synthetic_level_model, square_points, synthetic_polygon
from world import bsp_step, surface_material_programs
from world.static_placement_plan import ChunkRectangle

TILE_ID = '00_00'
TILE_UNIT_KEY = f'tile:{TILE_ID}'
SOURCE_IDENTITY = {'path': f'maps/{TILE_ID}.unr', 'sha256': 'a' * 64}
CHUNK_ID = 'chunk-0-0'
SURFACE_MATERIAL_REFERENCE, BRUSH_ACTOR_REFERENCE = 1, 2


def start_patch(test_case, owner, name, replacement):
    patcher = mock.patch.object(owner, name, replacement)
    patcher.start()
    test_case.addCleanup(patcher.stop)


def synthetic_locked_input_records(relative_paths):
    return [{'path': relative_path, 'sha256': hashlib.sha256(relative_path.encode('utf-8')).hexdigest()} for relative_path in sorted(relative_paths)]


def read_one_synthetic_bsp_node_instead_of_a_map(test_case, project_root, material_identity, map_sources, converter):
    model = build_synthetic_level_model([synthetic_polygon(square_points(0, 0, 100), material=SURFACE_MATERIAL_REFERENCE, actor=BRUSH_ACTOR_REFERENCE)])
    map_package = SimpleNamespace(object_name={SURFACE_MATERIAL_REFERENCE: material_identity, BRUSH_ACTOR_REFERENCE: f'{TILE_ID}.Brush7'}.get)
    chunk_plan = {'chunks': [{'chunkId': CHUNK_ID}]}
    replacements = {
        'read_tile_map_lock_record': mock.Mock(return_value={'eSha256': SOURCE_IDENTITY['sha256']}),
        'sealed_chunk_plan': mock.Mock(return_value=('b' * 64, project_root / 'raw-products', chunk_plan)),
        'tile_level_model_layout': mock.Mock(return_value='synthetic-layout'), 'implementation_hash': mock.Mock(return_value='c' * 64),
        'read_locked_map_package': mock.Mock(return_value=map_package),
        'read_level_model': mock.Mock(return_value=SimpleNamespace(model=model, binding={'model': {'qualified': f'{TILE_ID}.Model1'}})),
        'native_terrain': mock.Mock(), 'chunk_rectangles': mock.Mock(return_value=[ChunkRectangle(CHUNK_ID, (0.0, 0.0), (1024.0, 1024.0))]),
        'read_level_zones': mock.Mock(), 'sky_zone_indices': mock.Mock(return_value=frozenset()),
        'outdoor_zone_indices': mock.Mock(return_value=frozenset()), 'ClassDefaults': mock.Mock(), 'ReferenceClientClassScripts': mock.Mock(),
        'read_bsp_lightmaps': mock.Mock(), 'lightmap_texture_of_record': mock.Mock(return_value={}),
        'locked_input_records': mock.Mock(side_effect=synthetic_locked_input_records)}
    for name, replacement in replacements.items():
        start_patch(test_case, bsp_step, name, replacement)
    material_source_replacements = {'Converter': mock.Mock(return_value=converter), 'MapSources': mock.Mock(return_value=map_sources),
                                    'ReferenceClientClassScripts': mock.Mock()}
    for name, replacement in material_source_replacements.items():
        start_patch(test_case, surface_material_programs, name, replacement)
