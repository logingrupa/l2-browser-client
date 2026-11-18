from native_assets_lib.class_defaults import ReferenceClientClassScripts
from native_assets_lib.material_resources import write_material_program_record
from native_assets_lib.texture_package_118 import read_unreal_package
from native_catalog.ue2 import FormatError
from native_store.store_paths import StorePathError
from world.bsp_material_mapping_size import mapping_size_outcome, reference_client_class_default_value
from world.error_detail import conversion_failure_reason
from world.map_sources import MapSources, require_lock_equal_client_path
from world.material_texture_images import write_material_texture_images
from world.sky_geometry import SkyRootSurface
from world.sky_materials import SkyTextureUnsupported, read_sky_material_graph, single_graph_texture_export, sky_material_program, \
    sky_texture_pngs_by_node, sky_texture_products_by_node
from world.static_placement_plan import FAILED_STATUS
from world.struct_property_tag_rules import read_struct_property_tag_rules
from world.struct_property_values import decode_binary_struct_hex
from world.surface_material_programs import material_gap_row_status
from world.tile_census_validation import GAP_STATUS

MATERIAL_FEATURE_UNPORTED_REASON_PREFIX = 'material-feature-unported:'
UNPORTED_NODE_STATUS = 'unported'
AUTHORED_PROVENANCE = 'authored'
SKY_ROOT_PRESENTATION_FIELDS = ('Color', 'AlphaBlend', 'RenderTwoSided')
COLOR_STRUCT_NAME = 'Color'
RGBA_CHANNEL_ORDER = ('R', 'G', 'B', 'A')


class SkyMaterialPackages:
    def __init__(self, client):
        self.client, self.map_sources, self.packages = client, MapSources(client), {}

    @property
    def paths(self):
        return self.map_sources.paths

    def get(self, relative):
        if relative not in self.packages:
            path = require_lock_equal_client_path(self.client, relative)
            self.packages[relative] = read_unreal_package(path.read_bytes(), path.name)
        return self.packages[relative]

    def resolve(self, identity):
        candidates = self.paths.get(identity.split('.')[0].casefold(), [])
        if len(candidates) != 1:
            raise FormatError(f'sky material package of {identity} is missing or ambiguous: {candidates}')
        relative = candidates[0]
        package = self.get(relative)
        matches = [item for item in package.exports if item['object'].casefold() == identity.casefold()]
        if len(matches) != 1:
            raise FormatError(f'sky material export {identity} is missing or ambiguous in {relative}')
        return package, matches[0]


def root_presentation_fields(program):
    root = next(node for node in program['nodes'] if node['id'] == program['root'])
    return {field['field']: field for field in root['fields'] if field['field'] in SKY_ROOT_PRESENTATION_FIELDS}


def is_serialized_colour(value):
    return isinstance(value, dict) and isinstance(value.get('rawHex'), str) and len(value['rawHex']) == 8


def is_typed_colour(value):
    return isinstance(value, dict) and set(value) == set(RGBA_CHANNEL_ORDER) and all(type(value[channel]) is int and 0 <= value[channel] <= 255
                                                                                     for channel in RGBA_CHANNEL_ORDER)


def presentation_field_gap(fields):
    color = fields.get('Color', {}).get('value')
    if not (is_serialized_colour(color) or is_typed_colour(color)):
        return MATERIAL_FEATURE_UNPORTED_REASON_PREFIX + 'Color'
    for name in ('AlphaBlend', 'RenderTwoSided'):
        if type(fields.get(name, {}).get('value')) is not bool:
            return MATERIAL_FEATURE_UNPORTED_REASON_PREFIX + name
    return None


def root_colour_rgba(color_value):
    channels = color_value if is_typed_colour(color_value) else decode_binary_struct_hex(
        color_value['rawHex'], read_struct_property_tag_rules().binary_struct_layout(COLOR_STRUCT_NAME))
    return [channels[channel] for channel in RGBA_CHANNEL_ORDER]


def alpha_source(field):
    return 'serialized' if field['provenance'] == AUTHORED_PROVENANCE else f'{field.get("valueDeclaringClass")} class default'


class SkyRootConversion:
    def __init__(self, client, store_root, class_work_root, gaps):
        self.packages, self.store_root, self.gaps = SkyMaterialPackages(client), store_root, gaps
        self.class_work_root, self.class_scripts = class_work_root, ReferenceClientClassScripts(client)
        self.class_default_value = reference_client_class_default_value(self.class_work_root, self.class_scripts)
        self.texture_files, self.material_files, self.materials = {}, {}, []

    def add_texture_files(self, files):
        for name, payload in files.items():
            if self.texture_files.get(name, payload) != payload:
                raise FormatError(f'two sky textures write different bytes to {name}')
            self.texture_files[name] = payload

    def convert(self, identity):
        try:
            package, root_export = self.packages.resolve(identity)
            [material] = read_sky_material_graph(package, [root_export])
            products, texture_gap_reasons = sky_texture_products_by_node(package, material.graph)
            pngs_by_node = sky_texture_pngs_by_node(products)
            program = sky_material_program(material.graph, self.class_work_root, self.class_scripts, pngs_by_node)
            program_record, program_files = write_material_program_record(self.store_root, material.graph, program)
            image_files = write_material_texture_images(self.store_root, pngs_by_node)
        except StorePathError:
            raise
        except (FormatError, ValueError) as error:
            self.gaps.add(FAILED_STATUS, conversion_failure_reason(error), identity)
            return None
        self.material_files.update((record['path'], record) for record in [*program_files, *image_files])
        self.materials.append({'mapReference': identity, 'root': root_export['object'], 'program': program_record, 'gapReasons': material.gap_reasons})
        for reason in [*material.gap_reasons, *texture_gap_reasons]:
            self.gaps.add(GAP_STATUS, reason, root_export['object'])
        root_node = next(node for node in material.graph['nodes'] if node['exportIndex'] == root_export['exportIndex'])
        fields = root_presentation_fields(program)
        field_gap = presentation_field_gap(fields)
        if root_node['status'] == UNPORTED_NODE_STATUS or field_gap is not None:
            if field_gap is not None:
                self.gaps.add(GAP_STATUS, field_gap, root_export['object'])
            return None
        try:
            drawn_texture = single_graph_texture_export(package, material.graph)
        except SkyTextureUnsupported as error:
            self.gaps.add(GAP_STATUS, error.reason, root_export['object'])
            return None
        if drawn_texture['object'] not in products:
            return None
        mapping_size, mapping_gap_reasons = mapping_size_outcome(identity, self.packages, self.class_default_value)
        for reason in mapping_gap_reasons:
            self.gaps.add(material_gap_row_status(reason), reason, root_export['object'])
        if mapping_size is None:
            return None
        receipt, files = products[drawn_texture['object']]
        self.add_texture_files(files)
        return SkyRootSurface(root_export['object'], identity, root_colour_rgba(fields['Color']['value']), fields['AlphaBlend']['value'],
                              alpha_source(fields['AlphaBlend']), fields['RenderTwoSided']['value'], receipt, mapping_size)
