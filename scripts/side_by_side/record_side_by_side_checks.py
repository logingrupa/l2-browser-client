from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_ROOT))

from native_store.store_paths import REPOSITORY_ROOT
from side_by_side.build_pair_queue import PART_BY_KIND, queue_entry_counts, write_pair_queue
from side_by_side.side_by_side_receipts import ingest_sandbox_halves

IMAGE_PARTS = tuple(sorted(set(PART_BY_KIND.values())))


def project_relative_text(project_root, path):
    path, project_root = Path(path).absolute(), Path(project_root).absolute()
    return path.relative_to(project_root).as_posix() if path.is_relative_to(project_root) else path.as_posix()


def run_queue(project_root, arguments, run_command):
    path, document = write_pair_queue(project_root, arguments.store_root)
    return {'queueFile': project_relative_text(project_root, path), 'catalogSha256': document['catalogSha256'],
            'counts': queue_entry_counts(document)}


def run_ingest_sandbox_halves(project_root, arguments, run_command):
    return ingest_sandbox_halves(project_root, arguments.part, arguments.store_root)


def command_parser():
    parser = argparse.ArgumentParser(description='Write the pair queue and the side-by-side check records through the one validated writer.')
    subparsers = parser.add_subparsers(dest='command', required=True)
    queue_parser = subparsers.add_parser('queue', help='write the ignored pair queue of the union catalog')
    queue_parser.add_argument('--store-root', type=Path, required=True)
    queue_parser.set_defaults(run=run_queue)
    ingest_parser = subparsers.add_parser('ingest-sandbox-halves', help='turn sandbox receipts into unverified check records')
    ingest_parser.add_argument('--part', choices=IMAGE_PARTS, required=True)
    ingest_parser.add_argument('--store-root', type=Path, required=True)
    ingest_parser.set_defaults(run=run_ingest_sandbox_halves)
    return parser


def main(argv=None, project_root=REPOSITORY_ROOT, run_command=subprocess.run):
    arguments = command_parser().parse_args(argv)
    try:
        result = arguments.run(project_root, arguments, run_command)
    except (OSError, ValueError) as error:
        print(f'Side-by-side {arguments.command} failed: {error}', file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
