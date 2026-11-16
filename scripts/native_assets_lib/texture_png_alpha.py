from native_assets_lib.png_rgba_codec import png_has_alpha_channel, rgba_png_of_rgb_png_and_alpha
from native_assets_lib.texture_block_alpha import OPAQUE_ALPHA, native_mip0_alpha
from native_assets_lib.texture_mips import UnsupportedTextureSource, build_texture_source


def texture_png_keeping_native_alpha(png, package, item):
    if png_has_alpha_channel(png):
        return png
    try:
        metadata, files = build_texture_source(package, item)
    except UnsupportedTextureSource:
        return png
    alpha = native_mip0_alpha(metadata, files)
    if alpha is None or all(value == OPAQUE_ALPHA for value in alpha):
        return png
    mip0 = metadata['mips'][0]
    return rgba_png_of_rgb_png_and_alpha(png, mip0['width'], mip0['height'], alpha)
