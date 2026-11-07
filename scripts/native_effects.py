"""Extract source-backed native Interlude skill effects; never execute game code."""
import argparse
from pathlib import Path
import subprocess
import sys
from native_catalog.effects import extract, verify, UELIB, POWERSHELL
from native_catalog.ue2 import FormatError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, default=Path('E:/lineage2-client'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--skill', type=int, default=1011)
    parser.add_argument('--level', type=int, default=1)
    parser.add_argument('--uelib', type=Path, default=UELIB)
    parser.add_argument('--powershell', type=Path, default=POWERSHELL)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    try:
        client, output = args.client.resolve(strict=True), args.output.resolve()
        if output.is_relative_to(client):
            raise FormatError('Effect output must be outside the native client')
        if args.verify:
            verify(client, output)
            print('Verified native effect sources and all declared artifacts.')
            return 0
        graph = extract(client, output, args.skill, args.level, args.uelib, args.powershell)
        print(f'Extracted skill {args.skill}/{args.level}: {len(graph["stages"])} source actions, {len(graph["effects"])} effects, {len(graph["dependencies"])} resolved dependency references.')
        print(f'Unresolved dependencies: {len(graph["unresolvedDependencies"])}; unparsed fields: {graph["unparsedPropertyCount"]}; explicit unsupported runtime features: {graph["unsupportedFeatureCount"]}.')
        return 0
    except (OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        print('Native effects failed: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
