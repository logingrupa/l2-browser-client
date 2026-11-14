from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys

SCRIPTS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_ROOT))

from native_store.side_by_side_check_records import AUDIO_ROLES, SIDE_BY_SIDE_VERDICTS, STORED_UNVERIFIED_REASONS
from native_store.side_by_side_check_halves import AUDIO_PART
from native_store.store_paths import REPOSITORY_ROOT
from side_by_side.audio_clip_receipts import ingest_audio_clips
from side_by_side.build_pair_queue import IMAGE_PARTS, queue_entry_counts, write_pair_queue
from side_by_side.side_by_side_judgements import SideBySideJudgement, judge_side_by_side_record
from side_by_side.side_by_side_receipts import ingest_sandbox_halves


def project_relative_text(project_root, path):
    path, project_root = Path(path).absolute(), Path(project_root).absolute()
    return path.relative_to(project_root).as_posix() if path.is_relative_to(project_root) else path.as_posix()


def run_queue(project_root, arguments, run_command):
    path, document = write_pair_queue(project_root, arguments.store_root)
    return {'queueFile': project_relative_text(project_root, path), 'catalogSha256': document['catalogSha256'],
            'counts': queue_entry_counts(document)}


def run_ingest_sandbox_halves(project_root, arguments, run_command):
    return ingest_sandbox_halves(project_root, arguments.part, arguments.store_root)


def run_ingest_audio_clips(project_root, arguments, run_command):
    return ingest_audio_clips(project_root, arguments.store_root)


def run_judge(project_root, arguments, run_command):
    judgement = SideBySideJudgement(arguments.part, arguments.key, arguments.verdict, arguments.reviewer, arguments.reason,
                                    arguments.difference, arguments.suspected_step, arguments.role, arguments.source_sha256)
    return judge_side_by_side_record(project_root, judgement, run_command)


def add_judge_parser(subparsers):
    judge_parser = subparsers.add_parser('judge', help='record a reviewer verdict on one check record')
    judge_parser.add_argument('--part', choices=(*IMAGE_PARTS, AUDIO_PART), required=True)
    judge_parser.add_argument('--key', required=True)
    judge_parser.add_argument('--role', choices=AUDIO_ROLES)
    judge_parser.add_argument('--source-sha256')
    judge_parser.add_argument('--verdict', choices=SIDE_BY_SIDE_VERDICTS, required=True)
    judge_parser.add_argument('--reason', choices=STORED_UNVERIFIED_REASONS)
    judge_parser.add_argument('--difference')
    judge_parser.add_argument('--suspected-step')
    judge_parser.add_argument('--reviewer', required=True)
    judge_parser.set_defaults(run=run_judge)


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
    audio_parser = subparsers.add_parser('ingest-audio-clips', help='turn labelled audio clip receipts into listen-needs-owner records')
    audio_parser.add_argument('--store-root', type=Path, required=True)
    audio_parser.set_defaults(run=run_ingest_audio_clips)
    add_judge_parser(subparsers)
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
