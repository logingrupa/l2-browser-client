from pathlib import Path
import subprocess
import tempfile
from typing import NamedTuple

from native_assets import UMODEL, Converter
from native_assets_lib.class_defaults import ReferenceClientClassScripts
from native_assets_lib.material_graph import read_material_graph
from native_assets_lib.material_program import derive_material_program
from native_assets_lib.material_resources import write_material_program_record
from native_assets_lib.material_texture_mip_chain import native_mip_chain_of_texture_source
from native_assets_lib.texture_png_alpha import texture_source_or_unsupported
from native_catalog.ue2 import FormatError
from native_store.gap_rows import QUALIFIED_OBJECT_NAME_PATTERN
from native_store.store_paths import StorePathError, lane_store_root, lane_work_root
from world.class_default_reads import kept_material_class_defaults
from world.map_sources import MapSources
from world.raw_map_step import tile_step_row
from world.material_texture_images import (MaterialTexturePng, material_texture_image_pins, reviewed_texture_nodes, stored_material_texture_images,
                                           write_material_texture_images)
from world.error_detail import conversion_failure_reason
from world.static_mesh_converter_folder import STATIC_MESH_CONVERTER_FOLDER
from world.static_placement_plan import FAILED_STATUS
from world.world_lane_names import WORLD_LANE_NAME
from world.tile_census_validation import GAP_STATUS

UNPORTED_NODE_STATUS = 'unported'
MATERIAL_GAP_REASON_PREFIX = 'material-'
MATERIAL_CONVERSION_ERRORS = (ValueError, subprocess.TimeoutExpired)


class WorldMaterialSources(NamedTuple):
    map_sources: object
    converter: object
    class_work_root: Path
    class_scripts: object
    store_root: Path


class MaterialProgramOutcome(NamedTuple):
    program: dict | None
    program_record: dict | None
    gap_reasons: list
    store_outputs: list


def world_material_sources(client, project_root):
    converter = Converter(client, lane_work_root(project_root, WORLD_LANE_NAME) / STATIC_MESH_CONVERTER_FOLDER, UMODEL, project_root=project_root)
    return WorldMaterialSources(MapSources(client), converter, lane_work_root(project_root, WORLD_LANE_NAME), ReferenceClientClassScripts(client),
                                lane_store_root(project_root, WORLD_LANE_NAME))


def material_package_paths(map_sources, identities):
    return sorted({paths[0] for identity in identities if len(paths := map_sources.paths.get(identity.split('.')[0].casefold(), [])) == 1})


def resolve_material_export(map_sources, identity):
    candidates = map_sources.paths.get(identity.split('.')[0].casefold(), [])
    if len(candidates) != 1:
        raise FormatError(f'material package missing or ambiguous: {identity}')
    package = map_sources.get(candidates[0])
    matches = [item for item in package.exports if item['object'].casefold() == identity.casefold()]
    if len(matches) != 1:
        raise FormatError(f'material export missing or ambiguous: {identity}')
    return package, matches[0]


def material_gap_row_status(reason):
    return GAP_STATUS if reason.startswith(MATERIAL_GAP_REASON_PREFIX) else FAILED_STATUS


def root_program_node(program):
    return next(node for node in program['nodes'] if node['id'] == program['root'])


def program_root_is_ported(program):
    return root_program_node(program)['status'] != UNPORTED_NODE_STATUS


def material_texture_pngs(package, graph, converter, store_root):
    stored_images = stored_material_texture_images(store_root)
    pngs_by_node, gap_reasons = {}, []
    for node in reviewed_texture_nodes(graph):
        png = stored_images.stored_png(node['object'])
        try:
            if png is None:
                with tempfile.TemporaryDirectory(dir=converter.output) as work:
                    png, _, _ = converter.texture(Path(work), node['object'])
                stored_images.remember(node['object'], png)
            native_source = texture_source_or_unsupported(package, package.exports[node['exportIndex'] - 1])
        except MATERIAL_CONVERSION_ERRORS as error:
            gap_reasons.append(conversion_failure_reason(error))
            continue
        pngs_by_node[node['object']] = MaterialTexturePng(png, native_mip_chain_of_texture_source(native_source))
    return pngs_by_node, gap_reasons


def material_program_outcome(identity, map_sources, converter, class_work_root, class_scripts, store_root):
    try:
        package, item = resolve_material_export(map_sources, identity)
        graph = read_material_graph(package, item)
        pngs_by_node, texture_gap_reasons = material_texture_pngs(package, graph, converter, store_root)
        program = derive_material_program(graph, kept_material_class_defaults(graph, class_work_root, class_scripts),
                                          texture_images=material_texture_image_pins(pngs_by_node))
        program_record, program_files = write_material_program_record(store_root, graph, program)
        store_outputs = [*program_files, *write_material_texture_images(store_root, pngs_by_node)]
    except StorePathError:
        raise
    except MATERIAL_CONVERSION_ERRORS as error:
        return MaterialProgramOutcome(None, None, [conversion_failure_reason(error)], [])
    return MaterialProgramOutcome(program, program_record, sorted({*program['gapReasons'], *texture_gap_reasons}), store_outputs)


def material_outcome_gap_rows(tile_id, step_name, source_identity, evidence, outcomes):
    rows = []
    for identity, outcome in outcomes.items():
        object_identity = {**source_identity, 'object': identity} if QUALIFIED_OBJECT_NAME_PATTERN.fullmatch(identity) else source_identity
        rows.extend(tile_step_row(tile_id, step_name, GAP_STATUS if reason.startswith(MATERIAL_GAP_REASON_PREFIX) else FAILED_STATUS, reason,
                                  object_identity, evidence)
                    for reason in outcome.gap_reasons)
    return rows
