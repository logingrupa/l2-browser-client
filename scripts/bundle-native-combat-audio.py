#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import sys

from native_assets_lib.combat_audio_bundle import run
from native_assets_lib.strict_json import decode_strict_json

COMBAT_AUDIO_BUNDLE_DESCRIPTION = ('Bundle selected combat sound table rows and existing verified WAVs; no export or staging. '
                                   'A recipe whose selections record unresolved role routing is refused before the builder runs.')


def unresolved_role_routes(recipe):
    selections = recipe.get('selections') if isinstance(recipe, dict) else None
    routes = []
    for selection in selections if isinstance(selections, list) else []:
        unresolved = selection.get('unresolved') if isinstance(selection, dict) else None
        roles = unresolved.get('roles') if isinstance(unresolved, dict) else None
        if not isinstance(roles, dict):
            continue
        for role, entry in roles.items():
            reason = entry.get('reason') if isinstance(entry, dict) else None
            routes.append(f'{selection.get("id")}/{role} {reason}')
    return routes


def main():
    parser = argparse.ArgumentParser(description=COMBAT_AUDIO_BUNDLE_DESCRIPTION)
    parser.add_argument('--recipe', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--plan', action='store_true')
    mode.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    try:
        routes = unresolved_role_routes(decode_strict_json(args.recipe.read_bytes()))
        if routes:
            print('Combat audio bundle refused: role routing is unresolved for ' + '; '.join(routes), file=sys.stderr)
            return 1
        result = run(Path(__file__).resolve().parent.parent, args.recipe, args.output, plan=args.plan, verify_only=args.verify_only)
        print(json.dumps(result, indent=2))
        return 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        print('Combat audio bundle refused: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
