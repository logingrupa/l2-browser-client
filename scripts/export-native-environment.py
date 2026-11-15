#!/usr/bin/env python3
"""Convert copied Interlude Env/timeenv inputs to immutable ordered source data.

Example: python -B scripts/export-native-environment.py --input-dir <copies>
         --output <fresh-dir> [--files Env.int timeenv0.int ...] [--verify-only]
Repeat verifies existing bytes without changing mtimes. A differing/unowned
output is refused. No runtime/catalog staging, clock selection or tint change.
Exit 0: supported typed tables; 2: retained unsupported table syntax; 1: failure.
"""
import argparse
import json
import sys

from native_environment import DEFAULT_FILES, convert


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--files', nargs='+', default=DEFAULT_FILES)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    try:
        result = convert(args.input_dir, args.output, args.files, args.verify_only)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0 if result['typedComplete'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
