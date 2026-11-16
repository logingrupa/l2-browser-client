from native_assets_lib.png_rgba_codec import png_chunks, png_has_alpha_channel, rgba_png_of_rgb_png_and_alpha
from native_assets_lib.texture_block_alpha import OPAQUE_ALPHA, native_mip0_alpha
from native_assets_lib.texture_mips import UnsupportedTextureSource, build_texture_source

TEXTURE_ALPHA_UNVERIFIED_REASON_PREFIX = 'texture-alpha-unverified:'
EXPORTER_ALPHA_STATUS = 'exporter-alpha'
NATIVE_OPAQUE_ALPHA_STATUS = 'native-opaque'
RESTORED_ALPHA_STATUS = 'restored'
UNVERIFIED_ALPHA_STATUS = 'unverified'


def texture_source_or_unsupported(package, item):
    try:
        return build_texture_source(package, item)
    except UnsupportedTextureSource as unsupported:
        return unsupported


def unverified_alpha(reason):
    return {'status': UNVERIFIED_ALPHA_STATUS, 'gapReason': TEXTURE_ALPHA_UNVERIFIED_REASON_PREFIX + reason}


def texture_png_keeping_native_alpha(png, native_source):
    chunks = png_chunks(png)
    if png_has_alpha_channel(chunks):
        return png, {'status': EXPORTER_ALPHA_STATUS}
    if isinstance(native_source, UnsupportedTextureSource):
        return png, unverified_alpha(native_source.reason)
    metadata, files = native_source
    alpha = native_mip0_alpha(metadata, files)
    if alpha is None:
        return png, unverified_alpha(metadata['format']['name'])
    if all(value == OPAQUE_ALPHA for value in alpha):
        return png, {'status': NATIVE_OPAQUE_ALPHA_STATUS}
    mip0 = metadata['mips'][0]
    return rgba_png_of_rgb_png_and_alpha(chunks, mip0['width'], mip0['height'], alpha), {'status': RESTORED_ALPHA_STATUS}


def native_alpha_limitations(native_alpha):
    if native_alpha['status'] == RESTORED_ALPHA_STATUS:
        return ['UModel wrote an RGB PNG for a native mip0 alpha that is not all 255; the PNG keeps UModel RGB with the native mip0 alpha.']
    if native_alpha['status'] == UNVERIFIED_ALPHA_STATUS:
        return [f'UModel wrote an RGB PNG and the native mip0 alpha was not checked: {native_alpha["gapReason"]}.']
    return []
