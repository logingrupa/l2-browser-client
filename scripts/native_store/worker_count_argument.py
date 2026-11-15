import argparse
import re

MAXIMUM_WORKER_COUNT = 61
WORKER_COUNT_PATTERN = re.compile(r'^[1-9][0-9]?$')


def worker_count_argument(text):
    if not WORKER_COUNT_PATTERN.fullmatch(text) or int(text) > MAXIMUM_WORKER_COUNT:
        raise argparse.ArgumentTypeError(f'--workers must be an integer from 1 to {MAXIMUM_WORKER_COUNT}: {text!r}')
    return int(text)
