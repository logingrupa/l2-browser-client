from native_store.store_paths import lane_store_root, lane_work_root


def create_lane_work_and_store_roots(project_root, lane_name):
    for lane_root in (lane_work_root(project_root, lane_name), lane_store_root(project_root, lane_name)):
        lane_root.mkdir(parents=True, exist_ok=True)
