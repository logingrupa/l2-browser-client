import hashlib
import json
from pathlib import Path
import zipfile

from native_assets import Converter, UMODEL, UMODEL_SHA256, verify_archive
from native_assets_lib.gltf import json_bytes
from native_catalog.ue2 import FormatError
from world.map_sources import MapSources, file_hash, safe_path
from world.mover_class_defaults import load_mover_class_defaults
from world.mover_records import MoverUnsupportedError, read_mover_actor

ROOT = Path(__file__).resolve().parents[1]
MAP_PATH = 'maps/20_20.unr'
MAP_SHA = '1beddad24c10a35a1b2e9151727a85158e3e01992299a6671de876645eb1f1e4'
MESH_PATH = 'staticmeshes/l2fortress_02_s.usx'
MESH_SHA = '1049a1075c90cdd3ecb9d739eb1828ffead45b3ad52661079552e60fe3b608b6'
ACTORS = ('Mover1', 'Mover61', 'Mover60', 'Mover195', 'Mover194', 'Mover193', 'Mover192', 'Mover24')
MESHES = ('l2fortress_02_s.Fort02_indoor', 'l2fortress_02_s.fort02_wall_door')
RAW_MAP = 'source/map.unwrapped.bin'


def require(value, message):
    if not value:
        raise FormatError(message)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def immutable_write(output, name, value):
    path = safe_path(output, name)
    if path.exists():
        require(path.read_bytes() == value, 'Existing mover output differs: ' + name)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)
    return name


def collect_movers(sources, defaults):
    package = sources.get(MAP_PATH)
    require(package.source_hash == MAP_SHA, 'Mover extraction requires the pinned original 20_20 map')
    items = [item for item in package.exports if item['classObject'] == 'Engine.Mover']
    require(tuple(item['name'] for item in items) == ACTORS, 'Exact native mover census changed')
    movers, meshes = [], {}
    for item in items:
        try:
            mover, mesh_source, _ = read_mover_actor(package, item, sources, defaults, MAP_PATH, RAW_MAP)
        except MoverUnsupportedError as error:
            raise FormatError('Only source-qualified initially closed two-key movers are supported: ' + error.reason) from error
        require(mesh_source['package'] == MESH_PATH and mesh_source['packageSha256'] == MESH_SHA and mesh_source['object'] in MESHES,
                'Unqualified native mover mesh')
        meshes[mover['modelId']] = mesh_source
        movers.append(mover)
    require(set(meshes) == {'interlude:' + name for name in MESHES}, 'Expected exactly two native mover meshes')
    return movers, meshes


def export(client, output, umodel=UMODEL):
    client, output = Path(client).resolve(strict=True), Path(output).resolve()
    require(output != client and not output.is_relative_to(client) and not client.is_relative_to(output),
            'Mover output overlaps read-only native source')
    require(output.is_relative_to(ROOT/'artifacts') and output != ROOT/'artifacts',
            'Mover extraction output must be dedicated artifacts scratch')
    output.mkdir(parents=True, exist_ok=True)
    files = {}

    def save(name, value):
        immutable_write(output, name, value)
        files[name] = {'sha256': sha(value), 'bytes': len(value)}
        return name

    definitions, defaults = load_mover_class_defaults(client, output, save)
    save('class-evidence.json', json_bytes(definitions))
    sources = MapSources(client)
    movers, mesh_sources = collect_movers(sources, defaults)
    package = sources.get(MAP_PATH)
    save(RAW_MAP, package.data)
    converter = Converter(client, output/'.work/converter', umodel)
    models = []
    dependencies = dict(sources.dependencies)
    for model_id, source in sorted(mesh_sources.items()):
        result = converter.convert({'kind': 'model', 'package': source['package'], 'object': source['object']})
        archive = Path(result['file'])
        checked = verify_archive(archive)
        require(checked['id'] == model_id, 'Converted mover model identity differs')
        prefix = 'models/' + checked['sha256'] + '/'
        with zipfile.ZipFile(archive) as zipped:
            manifest = json.loads(zipped.read('asset.json'))
            for item in manifest['files']:
                save(prefix + item['path'], zipped.read(item['path']))
            save(prefix + 'asset.json', zipped.read('asset.json'))
            provenance = json.loads(zipped.read('provenance.json'))
            for path, digest in provenance['dependencies'].items():
                entry = {'sha256': digest, 'bytes': safe_path(client, path).stat().st_size}
                require(path not in dependencies or dependencies[path] == entry, 'Model dependency changed')
                dependencies[path] = entry
            limitations = manifest['limitations']
        save(prefix + 'asset.l2asset', archive.read_bytes())
        relative, mesh_package, mesh = sources.resolve(source['object'], 'StaticMesh')
        save('source/meshes/' + source['object'] + '.bin', mesh_package.data[mesh['offset']:mesh['offset']+mesh['size']])
        models.append({'id': model_id, 'sourceObject': source['object'], 'source': source,
            'model': {'file': prefix+'model.glb', **files[prefix+'model.glb']},
            'archive': {'file': prefix+'asset.l2asset', **files[prefix+'asset.l2asset']},
            'limitations': limitations})
    for definition in definitions.values():
        source = definition['source']
        dependencies[source['package']] = {'sha256': source['packageSha256'],
            'bytes': safe_path(client, source['package']).stat().st_size}
    descriptor = {'schemaVersion': 1, 'kind': 'native-map-movers',
        'sourceMap': {'object': '20_20', 'package': MAP_PATH, 'packageSha256': MAP_SHA},
        'models': models, 'movers': movers, 'classEvidence': definitions,
        'transformConvention': 'glTF column-major; original local mesh coordinates X,Z,Y in metres; native BasePos+KeyPos and BaseRot+KeyRot; native PrePivot preserved',
        'sourceFiles': dependencies,
        'limitations': ['Native server permission, packet handling and runtime replication are not implemented by extraction.',
            'MoveTime and StayOpenTime are authored/inherited evidence; interaction range, interpolation policy and automatic closing are runtime policy.',
            'MeshGrade, RangeDelta, original sound references and undecoded payloads are preserved without inferred selection or dispatch.']}
    save('movers.json', json_bytes(descriptor))
    for path, record in dependencies.items():
        native = safe_path(client, path)
        require(file_hash(native) == record['sha256'] and native.stat().st_size == record['bytes'],
                'Native source changed during mover extraction: ' + path)
    receipt = {'schemaVersion': 1, 'kind': 'native-map-movers-bundle',
        'descriptor': {'file': 'movers.json', **files['movers.json']},
        'counts': {'movers': len(movers), 'models': len(models)}, 'files': files,
        'implementation': {name: file_hash(ROOT/'scripts'/name) for name in
            ('native_map_movers.py', 'derive-native-map-movers.py')}, 'umodelSha256': UMODEL_SHA256,
        'sourceFiles': dependencies}
    immutable_write(output, 'bundle.json', json_bytes(receipt))
    return {'status': 'prepared', 'descriptor': receipt['descriptor'], 'counts': receipt['counts'],
            'bundleSha256': file_hash(output/'bundle.json')}
