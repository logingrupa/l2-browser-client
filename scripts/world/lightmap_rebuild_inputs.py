from native_catalog.ue2 import FormatError
from world.lighting_payload import array, prefix_starts

SURFACE_NORMAL_AXES = 3
UNLISTED_SHADOW_LIGHT_INDEX = -1
SHADOW_LIGHT_UNLISTED_REASON_PREFIX = 'bsp-rebuild-shadow-light-unlisted:'


def texture_has_mismatched_page(texture):
    return any(page.revision != page.compressed_revision for page in texture.pages)


def rebuild_texture_flags(lightmaps):
    return [texture_has_mismatched_page(texture) for texture in lightmaps.textures]


def light_record_index_of_export(lights):
    return {light.export_index: record_index for record_index, light in enumerate(lights)}


def require_rebuild_texture_shares_page_records(texture_index, texture):
    if not texture.pages_share_records:
        raise FormatError(f'lightmap texture {texture_index} needs rebuild inputs, but its pages list different records')


def rebuild_record_shadow_masks(lightmaps, rebuild_flags):
    shadow_masks_of_record = [()] * len(lightmaps.records)
    for texture_index, (texture, rebuild) in enumerate(zip(lightmaps.textures, rebuild_flags)):
        if not rebuild:
            continue
        require_rebuild_texture_shares_page_records(texture_index, texture)
        for record_index in range(texture.first_record, texture.first_record + texture.record_count):
            shadow_masks_of_record[record_index] = lightmaps.records[record_index].shadow_masks
    return shadow_masks_of_record


def shadow_light_record_indices(shadow_masks, light_record_index):
    return [light_record_index.get(shadow_mask.light_reference, UNLISTED_SHADOW_LIGHT_INDEX) for shadow_mask in shadow_masks]


def unlisted_shadow_light_reasons(shadow_masks, light_record_index):
    unlisted = {shadow_mask.light_reference for shadow_mask in shadow_masks if shadow_mask.light_reference not in light_record_index}
    return [f'{SHADOW_LIGHT_UNLISTED_REASON_PREFIX}{reference}' for reference in sorted(unlisted)]


def record_surfaces(lightmaps, model):
    return [model.surfs[record.surface] for record in lightmaps.records]


def lightmap_rebuild_record_arrays(lightmaps, model, shadow_masks_of_record):
    surfaces = record_surfaces(lightmaps, model)
    return [array('LMRC.zone', 'int32', [record.zone_index for record in lightmaps.records]),
            array('LMRC.surfaceNormal', 'float32', [axis for surface in surfaces for axis in surface.plane[:SURFACE_NORMAL_AXES]]),
            array('LMRC.surfacePolyFlags', 'uint32', [surface.flags for surface in surfaces]),
            array('LMRC.shadowStart', 'uint32', prefix_starts(len(shadow_masks) for shadow_masks in shadow_masks_of_record))]


def lightmap_shadow_arrays(shadow_masks, light_record_index):
    return [array('LMSH.light', 'int32', shadow_light_record_indices(shadow_masks, light_record_index)),
            array('LMSH.width', 'int32', [shadow_mask.width for shadow_mask in shadow_masks]),
            array('LMSH.height', 'int32', [shadow_mask.height for shadow_mask in shadow_masks]),
            array('LMSH.rowBytes', 'int32', [shadow_mask.row_bytes for shadow_mask in shadow_masks]),
            array('LMSH.minimumX', 'int32', [shadow_mask.minimum_x for shadow_mask in shadow_masks]),
            array('LMSH.minimumY', 'int32', [shadow_mask.minimum_y for shadow_mask in shadow_masks]),
            array('LMSH.maximumX', 'int32', [shadow_mask.maximum_x for shadow_mask in shadow_masks]),
            array('LMSH.maximumY', 'int32', [shadow_mask.maximum_y for shadow_mask in shadow_masks]),
            array('LMSH.byteStart', 'uint32', prefix_starts(len(shadow_mask.bits) for shadow_mask in shadow_masks)),
            array('LMSH.bits', 'uint8', b''.join(shadow_mask.bits for shadow_mask in shadow_masks))]


def lightmap_rebuild_input_arrays(lightmaps, model, lights):
    rebuild_flags = rebuild_texture_flags(lightmaps)
    shadow_masks_of_record = rebuild_record_shadow_masks(lightmaps, rebuild_flags)
    shadow_masks = [shadow_mask for record_shadow_masks in shadow_masks_of_record for shadow_mask in record_shadow_masks]
    light_record_index = light_record_index_of_export(lights)
    arrays = [array('LMTX.rebuildInputs', 'uint8', [int(rebuild) for rebuild in rebuild_flags]),
              *lightmap_rebuild_record_arrays(lightmaps, model, shadow_masks_of_record),
              *lightmap_shadow_arrays(shadow_masks, light_record_index)]
    counts = {'rebuildTextures': sum(rebuild_flags), 'shadows': len(shadow_masks),
              'shadowLights': len({shadow_mask.light_reference for shadow_mask in shadow_masks}),
              'shadowBytes': sum(len(shadow_mask.bits) for shadow_mask in shadow_masks)}
    return arrays, counts, unlisted_shadow_light_reasons(shadow_masks, light_record_index)
