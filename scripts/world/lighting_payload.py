from typing import NamedTuple

from world.bsp_lightmaps import LIGHTMAP_PAGE_MIPS, NO_LIGHTMAP, node_lightmap_texture, node_lightmap_uvs
from world.typed_payload import BYTES_PER_ELEMENT_OF_TYPE, TYPED_PAYLOAD_ALIGNMENT, TypedPayloadArray

HOURS_PER_DAY = 24
NODE_RANGE_FIELDS = ('chunk', 'node', 'primitive', 'firstIndex', 'indexCount')


class LightmapNodeRange(NamedTuple):
    node_range: dict
    record: int
    texture: int
    uvs: tuple


def array(name, kind, values):
    return TypedPayloadArray(name, kind, tuple(values))


def prefix_starts(counts):
    starts = [0]
    for count in counts:
        starts.append(starts[-1] + count)
    return starts


def typed_payload_byte_count(arrays):
    total = 0
    for typed_array in arrays:
        total += len(typed_array.values) * BYTES_PER_ELEMENT_OF_TYPE[typed_array.type]
        total += -total % TYPED_PAYLOAD_ALIGNMENT
    return total


def lightmap_page_hours(page):
    return HOURS_PER_DAY * page.slot / page.slot_count, HOURS_PER_DAY * (page.slot + 1) / page.slot_count


def lightmap_node_ranges(package, lightmaps, model, node_ranges):
    ranges, reasons = [], set()
    for node_range in node_ranges:
        node = model.nodes[node_range['node']]
        texture, reason = node_lightmap_texture(lightmaps, node)
        if reason is not None:
            reasons.add(reason)
            ranges.append(LightmapNodeRange(node_range, node.i_light_map, NO_LIGHTMAP, ()))
        elif texture == NO_LIGHTMAP:
            ranges.append(LightmapNodeRange(node_range, NO_LIGHTMAP, NO_LIGHTMAP, ()))
        else:
            ranges.append(LightmapNodeRange(node_range, node.i_light_map, texture, tuple(node_lightmap_uvs(package, lightmaps, node))))
    return ranges, sorted(reasons)


def render_section_arrays(lightmaps):
    return [array('LMSC.lightmapTexture', 'int32', [section.lightmap_texture for section in lightmaps.sections]),
            array('LMSC.polyFlags', 'uint32', [section.poly_flags for section in lightmaps.sections])]


def lightmap_texture_arrays(lightmaps):
    return [array('LMTX.recordStart', 'uint32', prefix_starts(texture.record_count for texture in lightmaps.textures)),
            array('LMTX.pageStart', 'uint32', prefix_starts(len(texture.pages) for texture in lightmaps.textures))]


def lightmap_record_arrays(lightmaps):
    records = lightmaps.records
    return [array('LMRC.surface', 'int32', [record.surface for record in records]),
            array('LMRC.rectangle', 'int32', [value for record in records for value in record.rectangle]),
            array('LMRC.projection', 'float32', [value for record in records for value in record.projection]),
            array('LMRC.shadowMaskCount', 'int32', [record.shadow_mask_count for record in records])]


def lightmap_page_arrays(lightmaps):
    pages = lightmaps.pages
    hours = [lightmap_page_hours(page) for page in pages]
    mips = [mip for page in pages for mip in page.mips]
    return [array('LMPG.texture', 'int32', [page.texture for page in pages]), array('LMPG.slot', 'int32', [page.slot for page in pages]),
            array('LMPG.slotCount', 'int32', [page.slot_count for page in pages]),
            array('LMPG.hourStart', 'float32', [start for start, _ in hours]), array('LMPG.hourEnd', 'float32', [end for _, end in hours]),
            array('LMPG.header', 'int32', [value for page in pages for value in page.header]),
            array('LMPG.mipEdge', 'uint32', [edge for _ in pages for edge, _ in LIGHTMAP_PAGE_MIPS]),
            array('LMPG.texelStart', 'uint32', prefix_starts(len(mip) for mip in mips)),
            array('LMPG.texels', 'uint8', b''.join(mips))]


def lightmap_node_range_arrays(ranges):
    return [*(array(f'LMNR.{field}', 'int32', [lightmap_range.node_range[field] for lightmap_range in ranges]) for field in NODE_RANGE_FIELDS),
            array('LMNR.record', 'int32', [lightmap_range.record for lightmap_range in ranges]),
            array('LMNR.texture', 'int32', [lightmap_range.texture for lightmap_range in ranges]),
            array('LMNR.uvStart', 'uint32', prefix_starts(len(lightmap_range.uvs) for lightmap_range in ranges)),
            array('LMUV.uv', 'float32', [value for lightmap_range in ranges for uv in lightmap_range.uvs for value in uv])]


def bsp_lightmap_arrays(package, lightmaps, model, node_ranges):
    ranges, reasons = lightmap_node_ranges(package, lightmaps, model, node_ranges)
    arrays = [*render_section_arrays(lightmaps), *lightmap_texture_arrays(lightmaps), *lightmap_record_arrays(lightmaps),
              *lightmap_page_arrays(lightmaps), *lightmap_node_range_arrays(ranges)]
    counts = {'renderSections': len(lightmaps.sections), 'records': len(lightmaps.records), 'textures': len(lightmaps.textures),
              'pages': len(lightmaps.pages), 'nodeRanges': len(ranges), 'litNodeRanges': sum(1 for item in ranges if item.uvs),
              'uvs': sum(len(item.uvs) for item in ranges), 'unwalkedTailBytes': lightmaps.unwalked_tail_bytes}
    return arrays, reasons, counts
