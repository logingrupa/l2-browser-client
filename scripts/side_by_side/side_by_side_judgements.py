from __future__ import annotations

from typing import NamedTuple

from native_store.side_by_side_check_halves import AUDIO_PART
from native_store.side_by_side_check_records import read_side_by_side_records, record_identity, write_side_by_side_records
from native_store.unit_ledger import read_machine_schedule
from side_by_side.pair_queue_union import PairQueueError


class SideBySideJudgement(NamedTuple):
    part: str
    key: str
    verdict: str
    reviewer: str
    reason: str | None = None
    difference: str | None = None
    suspected_step: str | None = None
    role: str | None = None
    source_sha256: str | None = None

    def identity(self):
        if self.part == AUDIO_PART:
            if self.role is None or self.source_sha256 is None:
                raise PairQueueError('judge of an audio record needs --role and --source-sha256')
            return self.key, self.role, self.source_sha256
        if self.role is not None or self.source_sha256 is not None:
            raise PairQueueError(f'--role and --source-sha256 identify audio records only, not part {self.part}')
        return (self.key,)

    def require_verdict_arguments(self):
        if self.verdict == 'unverified' and (self.reason is None or self.difference is not None or self.suspected_step is not None):
            raise PairQueueError('judge --verdict unverified needs --reason and no --difference or --suspected-step')
        if self.verdict == 'mismatch' and (self.reason is not None or self.difference is None or self.suspected_step is None):
            raise PairQueueError('judge --verdict mismatch needs --difference and --suspected-step and no --reason')
        if self.verdict == 'pass' and (self.reason is not None or self.difference is not None or self.suspected_step is not None):
            raise PairQueueError('judge --verdict pass takes no --reason, --difference or --suspected-step')


def stored_record_of(project_root, judgement):
    identity = judgement.identity()
    records = [record for record in read_side_by_side_records(project_root, judgement.part)
               if record_identity(record, judgement.part) == identity]
    if not records:
        raise PairQueueError(f'part {judgement.part} has no side-by-side record {identity!r} to judge; ingest its sandbox half first')
    return records[0]


def judge_side_by_side_record(project_root, judgement, run_command):
    judgement.require_verdict_arguments()
    stored_record = stored_record_of(project_root, judgement)
    _, schedule, _ = read_machine_schedule(run_command)
    judged_record = {**stored_record, 'verdict': judgement.verdict, 'reason': judgement.reason, 'difference': judgement.difference,
                     'suspectedStep': judgement.suspected_step, 'reviewer': judgement.reviewer, 'judgedAtRiga': schedule['rigaTime']}
    write_side_by_side_records(project_root, judgement.part, [judged_record])
    return {'part': judgement.part, 'identity': list(judgement.identity()), 'verdict': judgement.verdict, 'reason': judgement.reason,
            'reviewer': judgement.reviewer, 'judgedAtRiga': schedule['rigaTime']}
