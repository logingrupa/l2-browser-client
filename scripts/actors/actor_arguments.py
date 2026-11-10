import argparse
import re

TABLE_ID_PATTERN = re.compile(r'^[0-9]{1,10}$')
MAXIMUM_SAFE_INTEGER = 2 ** 53 - 1
SLICE_LIMIT_PATTERN = re.compile(r'^[1-9][0-9]{0,5}$')
CHARGRP_INDEX_PATTERN = re.compile(r'^(?:0|[1-9][0-9]{0,3})$')


def table_id_argument(flag):
    def parsed_table_id(text):
        if not TABLE_ID_PATTERN.fullmatch(text) or int(text) > MAXIMUM_SAFE_INTEGER:
            raise argparse.ArgumentTypeError(f'{flag} must match {TABLE_ID_PATTERN.pattern} within the safe integer range: {text!r}')
        return int(text)
    return parsed_table_id


def skill_level_argument(text):
    if not SLICE_LIMIT_PATTERN.fullmatch(text):
        raise argparse.ArgumentTypeError(f'--level must be an unpadded integer of at least 1: {text!r}')
    return int(text)


def slice_limit_argument(text):
    if not SLICE_LIMIT_PATTERN.fullmatch(text):
        raise argparse.ArgumentTypeError(f'--limit must be an integer of at least 1: {text!r}')
    return int(text)


def chargrp_index_argument(text):
    if not CHARGRP_INDEX_PATTERN.fullmatch(text):
        raise argparse.ArgumentTypeError(f'--character must be an unpadded chargrp row index from 0 to 9999: {text!r}')
    return int(text)
