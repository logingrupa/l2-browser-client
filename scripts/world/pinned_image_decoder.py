from pathlib import Path

import PIL
from PIL import DdsImagePlugin, Image, PngImagePlugin

from native_catalog.ue2 import FormatError
from world.bsp_reader_binding import pinned_bytes

PINNED_PILLOW_VERSION = '12.3.0'
DDS_PLUGIN_SHA256 = 'eae2016bb3476be917ff549086c18b89d8e911d0f6d3f0900486a90fe2808cac'
PNG_PLUGIN_SHA256 = '26e6495edc516f7589dea911c330d7f16d4ec96eed78af838da00902e77e6040'
IMAGING_BINARY_SHA256 = 'c8c519ec72bf75b2945b4fc4afa854af2fca8b970a403134f9ddda3e164d85e9'


def require_pinned_image_decoder():
    if PIL.__version__ != PINNED_PILLOW_VERSION:
        raise FormatError(f'textures decode only with the pinned Pillow {PINNED_PILLOW_VERSION}, found {PIL.__version__}')
    pinned_bytes(Path(DdsImagePlugin.__file__), DDS_PLUGIN_SHA256)
    pinned_bytes(Path(PngImagePlugin.__file__), PNG_PLUGIN_SHA256)
    pinned_bytes(Path(Image.core.__file__), IMAGING_BINARY_SHA256)
