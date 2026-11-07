#!/usr/bin/env python3
"""Bundle 20_20 MusicVolume music from locked originals; no staging or playback."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

from native_assets_lib.world_music import run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', type=Path, default=Path(__file__).resolve().parent.parent / 'recipes/native-music-20_20.json')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--ffmpeg', type=Path, default=None, help='Pinned AAC encoder (default: ffmpeg on PATH; hash must match the recipe)')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--plan', action='store_true')
    mode.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    try:
        result = run(Path(__file__).resolve().parent.parent, args.recipe, args.output, encoder=args.ffmpeg,
                     plan=args.plan, verify_only=args.verify_only)
        print(json.dumps(result, indent=2))
        return 0
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
        print('Music bundle refused: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
