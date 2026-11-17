import json
from pathlib import Path

from support.interprocess_lock_programs import record_event
from support.item_unit_worker_runs import wait_until_path_exists
from test_minimap_route_step import SyntheticTextureConverter, run_synthetic_route


class ReleaseGatedTextureConverter(SyntheticTextureConverter):
    def __init__(self, output, events_folder, process_name, release_path):
        super().__init__(output)
        self.events_folder, self.process_name, self.release_path = events_folder, process_name, Path(release_path)

    def convert(self, request):
        if not self.requests:
            record_event(self.events_folder, self.process_name + ' converting')
            wait_until_path_exists(self.release_path)
        return super().convert(request)


def run_route_program(project_root, events_folder, process_name, release_path):
    project_root = Path(project_root)
    record_event(events_folder, process_name + ' waiting')
    converter = ReleaseGatedTextureConverter(project_root / 'converter', events_folder, process_name, release_path)
    print(json.dumps(run_synthetic_route(project_root, converter)))
