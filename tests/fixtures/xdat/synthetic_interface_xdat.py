import struct
from typing import NamedTuple

WINDOW_PARENT_SENTINEL = 'undefined'
SYNTHETIC_STATE_GROUP = 'SyntheticState'
WINDOW_DRAWER_RESERVED_BYTES = 88


class SyntheticControl(NamedTuple):
    control_type: str
    name: str
    width: int
    height: int
    anchor: tuple
    textures: tuple


class SyntheticWindow(NamedTuple):
    name: str
    width: int
    height: int
    anchor: tuple
    controls: tuple


def serialized_string(value):
    raw = value.encode('ascii')
    return bytes([len(raw) + 1]) + raw + b'\0' if raw else b'\0'


def serialized_integers(*values):
    return struct.pack('<' + 'i' * len(values), *values)


def serialized_header(name, parent, width, height, anchor):
    self_anchor, target_anchor, target_name, offset_x, offset_y = anchor
    return (serialized_string(name) + serialized_string('undefined') + serialized_integers(0, 0) + serialized_string(parent)
            + serialized_string('undefined') * 2 + serialized_integers(1)
            + serialized_integers(1, 1, width, height)
            + serialized_integers(1, self_anchor, target_anchor) + serialized_string(target_name) + serialized_integers(offset_x, offset_y))


def serialized_window_tail():
    return (serialized_integers(0, 0, 0) + serialized_string('') + serialized_integers(0) + serialized_string(WINDOW_PARENT_SENTINEL)
            + serialized_string('') * 3 + bytes(WINDOW_DRAWER_RESERVED_BYTES) + serialized_integers(0))


def serialized_control(control, parent_name):
    return (serialized_string(control.control_type) + serialized_header(control.name, parent_name, control.width, control.height, control.anchor)
            + b''.join(serialized_string(texture) for texture in control.textures)
            + serialized_string(SYNTHETIC_STATE_GROUP) + serialized_integers(0))


def serialized_window(window):
    return (serialized_header(window.name, '', window.width, window.height, window.anchor) + serialized_window_tail()
            + serialized_string(SYNTHETIC_STATE_GROUP) + serialized_integers(len(window.controls))
            + b''.join(serialized_control(control, window.name) for control in window.controls))


def synthetic_interface_xdat(windows):
    return struct.pack('<I', len(windows)) + b''.join(serialized_window(window) for window in windows)


SYNTHETIC_WINDOWS = (
    SyntheticWindow('SyntheticStatusWnd', 200, 80, (1, 1, '', 0, 0), (
        SyntheticControl('Texture', 'SyntheticBackTex', 120, 60, (1, 1, '', 8, 10), ('SyntheticUI.StatusWnd.BackPlate',)),
        SyntheticControl('BarCtrl', 'SyntheticGaugeBar', 90, 12, (3, 3, 'SyntheticBackTex', -4, 6),
                         ('SyntheticUI.StatusWnd.GaugeFill', 'SyntheticUI.StatusWnd.GaugeBack')),
    )),
    SyntheticWindow('SyntheticRepeatedWnd', 64, 32, (5, 5, '', 0, 0), (
        SyntheticControl('Texture', 'SyntheticRepeatedTex', 32, 16, (1, 1, '', 2, 2), ('SyntheticUI.Repeated.Plate',)),
    )),
    SyntheticWindow('SyntheticPlainWnd', 48, 24, (9, 9, '', -12, -6), ()),
    SyntheticWindow('SyntheticRepeatedWnd', 64, 32, (7, 7, '', 4, 0), ()),
)
