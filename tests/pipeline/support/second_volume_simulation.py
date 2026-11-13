from unittest.mock import patch

from native_store import linked_file_copy


def simulate_a_second_volume(test_case):
    second_volume = patch.object(linked_file_copy, 'paths_are_on_one_volume', return_value=False)
    second_volume.start()
    test_case.addCleanup(second_volume.stop)
