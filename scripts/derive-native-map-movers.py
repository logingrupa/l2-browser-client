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


def run(args):
    return export(args.client, args.output, args.umodel)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--umodel', type=Path, default=UMODEL)
    print(json.dumps(run(parser.parse_args()), indent=2))
