import re
from typing import NamedTuple
import xml.etree.ElementTree as ElementTree

from .ue2 import FormatError

DESCRIPTOR_NAME = 'CT0 Interlude'


class TableSourceResolutionError(FormatError):
    pass


class DescriptorLink(NamedTuple):
    pattern: str
    layout: str
    version: str | None


def descriptor_layout_links(descriptor_bytes):
    descriptor = ElementTree.fromstring(descriptor_bytes)
    if descriptor.get('name') != DESCRIPTOR_NAME:
        raise TableSourceResolutionError(f'descriptor is not {DESCRIPTOR_NAME}: {descriptor.get("name")!r}')
    links = [DescriptorLink(link.get('pattern'), link.get('file'), link.get('version')) for link in descriptor.iter('link')]
    if any(not link.pattern or not link.layout for link in links):
        raise TableSourceResolutionError('descriptor link without pattern or file')
    return links


def matches_link_pattern(link_pattern, file_name):
    return re.fullmatch(link_pattern, file_name, re.IGNORECASE) is not None


def descriptor_layout_for_file_name(file_name, links):
    matched_layouts = [link.layout for link in links if matches_link_pattern(link.pattern, file_name)]
    if len(matched_layouts) > 1:
        raise TableSourceResolutionError(f'descriptor matches more than one layout for {file_name}: {", ".join(matched_layouts)}')
    return matched_layouts[0] if matched_layouts else None


def is_bare_file_name(file_name):
    return isinstance(file_name, str) and bool(file_name) and '/' not in file_name and '\\' not in file_name


def resolve_table_source_file_name(file_names, link_pattern, explicit_file_name=None):
    matches = sorted(file_name for file_name in file_names if matches_link_pattern(link_pattern, file_name))
    if explicit_file_name is None:
        if len(matches) != 1:
            raise TableSourceResolutionError(
                f'link pattern {link_pattern} matches {len(matches)} source files, expected 1: {", ".join(matches) or "none"}')
        return matches[0]
    if not is_bare_file_name(explicit_file_name):
        raise TableSourceResolutionError(f'explicit source file name must be a bare file name: {explicit_file_name!r}')
    if explicit_file_name not in matches:
        raise TableSourceResolutionError(
            f'explicit source file name {explicit_file_name} is not a directory entry matching {link_pattern}: {", ".join(matches) or "none"}')
    return explicit_file_name
