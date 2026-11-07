"""Derive an immutable asset archive with proven original StaticMesh normals.

Uses existing exports and the hash-qualified source-stream proof; no exporter
or native executable is invoked. Runtime/Editor staging is a separate operation.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import zipfile

from native_assets import archive_bytes, verify_archive
from native_assets_lib.gltf import json_bytes, safe_name
from native_assets_lib.static_normals import TREE_PROOF_SHA256, restore_glb_static_normals
from native_catalog.ue2 import Package


def sha(data):
    return hashlib.sha256(data).hexdigest()


def require(value, message):
    if not value:
        raise ValueError(message)


def derive(archive_path, archive_sha256, client, proof_path, output):
    archive_path, client, proof_path, output = (Path(path).resolve() for path in (archive_path, client, proof_path, output))
    require(not output.is_relative_to(client), 'Normal output must stay outside the source client')
    original = archive_path.read_bytes()
    require(sha(original) == archive_sha256, 'Original archive hash differs')
    verify_archive(archive_path)
    proof_bytes = proof_path.read_bytes()
    require(sha(proof_bytes) == TREE_PROOF_SHA256, 'Unqualified native normal source proof')
    proof = json.loads(proof_bytes)
    package_path = (client / safe_name(proof['source']['package'])).resolve()
    require(package_path.is_relative_to(client), 'Native normal package escapes source client')
    source_bytes = package_path.read_bytes()
    package = Package(source_bytes, package_path.name)
    matches = [item for item in package.exports if item['exportIndex'] == proof['source']['exportIndex']]
    require(len(matches) == 1, 'Native normal export identity missing')
    with zipfile.ZipFile(archive_path) as archive:
        manifest = json.loads(archive.read('asset.json'))
        files = {entry['path']: archive.read(entry['path']) for entry in manifest['files']}
    require(manifest['kind'] == 'model' and manifest['source']['sha256'] == package.source_hash and
            manifest['source']['object'].casefold() == matches[0]['object'].casefold(), 'Asset/native normal source differs')
    provenance = json.loads(files['provenance.json'])
    inputs = {'archive': {'sha256': sha(original), 'bytes': len(original)},
              'sourceProof': {'sha256': sha(proof_bytes), 'bytes': len(proof_bytes)},
              'dependencies': {}}
    for name, expected in provenance['dependencies'].items():
        path = (client / safe_name(name)).resolve()
        require(path.is_relative_to(client), 'Native normal dependency escapes source client')
        payload = path.read_bytes()
        require(sha(payload) == expected, 'Native normal dependency changed: ' + name)
        inputs['dependencies'][name] = {'sha256': expected, 'bytes': len(payload)}
    model_file = manifest['model']['file']
    corrected, repair = restore_glb_static_normals(files[model_file], package, matches[0], proof_bytes)
    require(repair['changedBytes'] > 0, 'Input already has original normals; preserve previous derived product')
    added = {'native-static-normal-source.json', 'native-static-normal-repair.json', 'original-conversion-provenance.json'}
    require(not added.intersection(files), 'Archive already contains normal-restoration evidence')
    code = [Path(__file__), Path(__file__).parent / 'native_assets_lib/static_normals.py']
    implementation = {path.name: sha(path.read_bytes()) for path in code}
    repair.update(inputs=inputs, implementation=implementation,
                  limitations=['Exact source geometry normals only; native shader lighting and visible-pixel parity remain unverified.',
                               'No material, texture, transform, topology, UV or animation policy change.'])
    files[model_file] = corrected
    files['original-conversion-provenance.json'] = files['provenance.json']
    files['native-static-normal-source.json'] = proof_bytes
    files['native-static-normal-repair.json'] = json_bytes(repair)
    derived = copy.deepcopy(provenance)
    derived['nativeStaticNormalDerivation'] = {'sourceArchiveSha256': archive_sha256,
                                              'originalProvenance': 'original-conversion-provenance.json',
                                              'repair': 'native-static-normal-repair.json',
                                              'sourceProof': 'native-static-normal-source.json',
                                              'implementation': implementation}
    files['provenance.json'] = json_bytes(derived)
    manifest['files'] = [{'path': name, 'bytes': len(payload), 'sha256': sha(payload),
                          'mime': 'model/gltf-binary' if name == model_file else
                                  next((entry['mime'] for entry in manifest['files'] if entry['path'] == name), 'application/json')}
                         for name, payload in sorted(files.items())]
    payload = archive_bytes(manifest, files)
    content_hash = sha(payload)
    destination = output / content_hash
    products = {**files, 'asset.json': json_bytes(manifest), 'asset.l2asset': payload}
    unchanged = destination.exists()
    if unchanged:
        require({path.relative_to(destination).as_posix() for path in destination.rglob('*') if path.is_file()} == set(products),
                'Existing normal-restored output file set differs')
        require(all((destination / name).read_bytes() == value for name, value in products.items()),
                'Existing normal-restored output bytes differ')
    else:
        destination.mkdir(parents=True)
        for name, value in products.items():
            path = destination / safe_name(name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(value)
    require(archive_path.read_bytes() == original and proof_path.read_bytes() == proof_bytes,
            'Normal-restoration input changed during derivation')
    for name, identity in inputs['dependencies'].items():
        require(sha((client / name).read_bytes()) == identity['sha256'], 'Source dependency changed during derivation')
    verify_archive(destination / 'asset.l2asset')
    return {'status': 'unchanged' if unchanged else 'created', 'archive': str(destination / 'asset.l2asset'),
            'archiveSha256': content_hash, 'glbSha256': repair['glbAfterSha256'],
            'changedBytes': repair['changedBytes'], 'changedFloatFields': repair['changedFloatFields'],
            'vertices': repair['vertices'], 'runtimeStaged': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--archive-sha256', required=True)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--source-proof', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(derive(args.archive, args.archive_sha256, args.client, args.source_proof, args.output), indent=2))


if __name__ == '__main__':
    main()
