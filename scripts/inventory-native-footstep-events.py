#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import sys

from native_assets_lib.footstep_event_inventory import run

COMMAND_DESCRIPTION = 'Inventory selected Walk/Run footstep notifies of verified actor archives; no conversion or staging.'


def main():
    parser = argparse.ArgumentParser(description=COMMAND_DESCRIPTION)
    parser.add_argument('--recipe', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--plan', action='store_true')
    mode.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    try:
        result = run(Path(__file__).resolve().parent.parent, args.recipe, args.output,
                     plan=args.plan, verify_only=args.verify_only)
        print(json.dumps(result, indent=2))
        return 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        print('Footstep event inventory refused: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
