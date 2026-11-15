import hashlib
from pathlib import Path
import re

from actors.skill_dispatch_candidates import read_strict_json_bytes, require

REPLAY_SHA256 = 'bd9fd151e58abdf4e7deec506a8011692f0627e8e56063b4b7ab7c3f75ffb1c8'
R2_ARCHIVE_SHA256 = '85c4436d0b4b2ab26d6b19899a7a860fdfc26a9113498cba2d25fc62ec0e5fd2'
ANIMATION_NOTIFY_SHA256 = 'bd1bbaade886d03131bc7549bb965620c9b716f38f83e80724fbc32e8d7070ba'
ANIMATION_NOTIFY_SOURCE_FILE_NAME = 'new-skill-row-bindings-r2.json'
VERIFICATION_FOLDER_SUFFIX = '-verify'
DISPATCH_FACTS_FILE_NAME = 'verified-skill-dispatch-r2.md'
DISPATCH_REPLAY_REPORT_RELATIVE_PATH = 'q8-replay/replay-report.json'
ANIMATION_NOTIFY_FACTS_FILE_NAME = 'verified-animation-notify-bindings.md'
ANIMATION_NOTIFY_REPLAY_RESULT_RELATIVE_PATH = 'skill-bindings-r2-replay/replay-result.json'
CLIENT_TREE_PREFIX = 'c:\\lineage2-client\\'
FACTS_DATE = re.compile(r'^# .*\((\d{4}-\d{2}-\d{2})\)$', re.MULTILINE)
FACTS_WORKFLOW = re.compile(r'\bwf_[0-9a-f]{8}-[0-9a-f]{3}\b')


def client_relative_path(windows_path):
    require(isinstance(windows_path, str) and windows_path.casefold().startswith(CLIENT_TREE_PREFIX),
            f'source {windows_path!r} is not a reference client tree file')
    return windows_path[len(CLIENT_TREE_PREFIX):].replace('\\', '/').casefold()


def require_locked_source(lock, relative_path, cited_windows_path, sha256):
    require(client_relative_path(cited_windows_path) == relative_path, f'{cited_windows_path} is not {relative_path}')
    record = lock.record(relative_path)
    require(record is not None and record['class'] == 'equal' and record['importaSha256'] == record['eSha256'] == sha256,
            f'{relative_path} pin {sha256} differs from the reference client lock')
    return {'path': relative_path, 'sha256': sha256}


def verification_folder_of(replay_path):
    return replay_path.parent.with_name(replay_path.parent.name + VERIFICATION_FOLDER_SUFFIX)


def read_pinned_json(path, sha256, label):
    payload = Path(path).read_bytes()
    require(hashlib.sha256(payload).hexdigest() == sha256, f'{label} {Path(path).name} is not the pinned {sha256}')
    return read_strict_json_bytes(payload, label)


def verified_facts_identity(facts_path):
    payload = Path(facts_path).read_bytes()
    text = payload.decode('utf-8')
    dates, workflows = FACTS_DATE.findall(text), sorted(set(FACTS_WORKFLOW.findall(text)))
    require(len(dates) == 1 and len(workflows) == 1, f'{Path(facts_path).name} must name one date heading and one workflow')
    return {'date': dates[0], 'workflow': workflows[0], 'factsSha256': hashlib.sha256(payload).hexdigest()}
