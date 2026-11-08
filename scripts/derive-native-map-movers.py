#!/usr/bin/env python3
"""Prepare source-qualified native doors/gates in an isolated immutable bundle.

Does not stage a catalog, rewrite the Editor world, start a game/browser or
change the separate static mesh pipeline. The caller owns runtime integration.
"""
import argparse
import json
from pathlib import Path

from native_assets import UMODEL
from native_map_movers import export
from reference_client_guard import require_reference_client


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--umodel', type=Path, default=UMODEL)
    args = parser.parse_args()
    require_reference_client(args.client)
    print(json.dumps(export(args.client, args.output, args.umodel), indent=2))


if __name__ == '__main__':
    main()
