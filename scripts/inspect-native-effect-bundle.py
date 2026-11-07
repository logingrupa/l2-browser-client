#!/usr/bin/env python3
"""Inspect an existing effect bundle without conversion or runtime simulation."""
import argparse
import json
from pathlib import Path
import sys

from native_assets_lib.effect_readiness import run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True, type=Path, help='Bundle directory or manifest.json')
    parser.add_argument('--output', required=True, type=Path, help='Immutable JSON report outside the bundle')
    parser.add_argument('--verify', action='store_true', help='Compare exact existing report; write nothing')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.bundle, args.output, verify=args.verify), indent=2))
        return 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        print('Effect readiness inspection refused: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
