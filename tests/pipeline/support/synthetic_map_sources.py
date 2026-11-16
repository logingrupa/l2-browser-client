import hashlib

SYNTHETIC_PACKAGE_FOLDER = 'textures'


class SyntheticMapSources:
    def __init__(self, *packages):
        self.package_of_path = {f'{SYNTHETIC_PACKAGE_FOLDER}/{package.filename}': package for package in packages}
        self.paths = {package.package_name.casefold(): [relative] for relative, package in self.package_of_path.items()}
        self.dependencies = {}

    def get(self, relative):
        payload = relative.encode('utf-8')
        self.dependencies[relative] = {'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)}
        return self.package_of_path[relative]
