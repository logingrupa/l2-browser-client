import json
import shutil
from typing import NamedTuple
import zipfile
from pathlib import Path, PurePosixPath

from actors.actor_census import SOUND_PACKAGE_SUFFIXES, ActorPackageCensus, package_name_of
from actors.actor_sound_bindings import (ACTOR_SOUND_STEP, actor_sound_bundle_id, actor_sound_gap_row,
                                         actor_sound_gap_rows, actor_sound_reference_counts, build_actor_sound_recipe,
                                         unresolved_reference_entries)
from actors.actor_unit_inventory import decoded_string_values
from actors.combat_role_routes import (bind_combat_role_routes, bound_route_records, combat_route_table_manifest,
                                       read_combat_role_route_proof)
from actors.combat_sound_route_recipe import read_combat_sound_route_recipe
from actors.npc_requests import CONVERTER_REFUSED_REASON_PREFIX, npc_sound_references
from actors.npc_store_records import file_output_record
from actors.path_free_messages import path_free_reason
from native_assets import UMODEL_SHA256, implementation_hash
from native_assets_lib import combat_audio_bundle
from native_assets_lib.footstep_config import sound_payload
from native_assets_lib.gltf import json_bytes
from native_assets_lib.sha256_identity import sha256_hex_digest
from native_assets_lib.skill_audio_bundle import REFERENCE, reference_candidates
from native_catalog.tables import interlude_table_layout
from native_store.canonical_json import canonical_json_bytes
from native_store.data_ui_table_manifest import DATA_UI_LANE_NAME, data_ui_table_manifest
from native_store.store_paths import REPOSITORY_ROOT
from native_store.unit_ledger import RECEIPT_RECORD_NAME, UnitLedger, locked_input_records
from reference_client_guard import ReferenceClientLockError

ACTOR_SOUND_UNIT_STEP = 'actor-sound'
ACTOR_SOUND_ALGORITHM_VERSION = 1
COMBAT_AUDIO_STORE_FOLDER = 'combat-audio'
ACTOR_SOUND_GAP_ROWS_RELATIVE_PATH = 'work/actor-sounds/actor-sound-gap-rows.json'
ACTOR_SOUND_TABLES_FOLDER = 'work/actor-sounds/tables'
SOUND_CLASS_OBJECT = 'Engine.Sound'
UNCONVERTED_SOURCE_STATUS = 'listed-not-converted'
CONVERTED_AUDIO_FILE_NAME = 'audio.wav'
NATIVE_PAYLOAD_FILE_NAME = 'native-payload.bin'
CONVERTED_ARCHIVE_FILE_NAME = 'asset.l2asset'
SOUND_OUTCOME_FILE_NAME = 'sound-outcome.json'
SOUND_UNIT_KEY_PREFIX = 'sound:'


class ActorSoundConversionError(ValueError):
    pass


class SoundUnitWork(NamedTuple):
    unit_key: str
    fingerprint: str
    request: dict
    inputs: list
    config: dict


class NoSoundBundle(NamedTuple):
    key: str
    reason: str
    source_table_identity: dict
    detail: dict


class BundleWork(NamedTuple):
    tables: list
    routes_by_table: dict
    inventory: dict
    coverage_rows: list
    converter_reasons: dict
    inputs: list
    config: dict
    fingerprint: str


class BundleStoreState(NamedTuple):
    combat_audio_record: dict | None
    gap_rows: list


def combat_audio_manifest_outputs(receipt):
    return [output for output in receipt['outputs'] if PurePosixPath(output['path']).parts[:2] == ('l2', COMBAT_AUDIO_STORE_FOLDER)]


def bundle_store_state(bundle_key, receipt):
    manifests = combat_audio_manifest_outputs(receipt)
    if not manifests:
        return BundleStoreState(None, receipt['gapRows'])
    record = {'id': actor_sound_bundle_id(bundle_key), 'manifest': '/' + manifests[0]['path'],
              'manifestBytes': manifests[0]['bytes'], 'manifestSha256': manifests[0]['path'].split('/')[2]}
    return BundleStoreState(record, receipt['gapRows'])


def lane_relative(lane_folder, path):
    return Path(path).relative_to(lane_folder).as_posix()


class ActorSoundConversionRun:
    def __init__(self, project_root, client_access, converter, store_root, work_root, decode_table):
        self.project_root, self.client_access, self.converter = Path(project_root), client_access, converter
        self.store_root, self.decode_table = Path(store_root), decode_table
        self.sound_ledger = UnitLedger(work_root, ACTOR_SOUND_UNIT_STEP, ACTOR_SOUND_ALGORITHM_VERSION)
        self.bundle_ledger = UnitLedger(work_root, ACTOR_SOUND_STEP, ACTOR_SOUND_ALGORITHM_VERSION)
        self.lane_folder = self.bundle_ledger.lane_folder
        self.package_census = ActorPackageCensus(client_access, [])
        self.route_proof = read_combat_role_route_proof()
        self.route_recipe = read_combat_sound_route_recipe(REPOSITORY_ROOT)
        self.converter_implementation_sha256 = implementation_hash()
        self.combat_audio_builder_sha256 = sha256_hex_digest(Path(combat_audio_bundle.__file__).read_bytes())
        self.tables, self.routes_by_table, self.packages = {}, {}, {}

    def repository_relative(self, path):
        return Path(path).relative_to(self.project_root).as_posix()

    def is_sound_package_reference(self, reference):
        paths = self.package_census.lock_equal_paths_by_stem.get(package_name_of(reference).casefold(), ())
        return bool(paths) and all(PurePosixPath(path).suffix.lower() in SOUND_PACKAGE_SUFFIXES for path in paths)

    def table(self, name):
        if name not in self.tables:
            decoded = self.decode_table(self.client_access.root, name)
            original_path, guarded_sha256 = self.client_access.require_equal_file_with_sha256(decoded['source'])
            original = original_path.read_bytes()
            if sha256_hex_digest(original) != decoded['sourceSha256'] or guarded_sha256 != decoded['sourceSha256']:
                raise ActorSoundConversionError(f'{decoded["source"]} changed between decoding and the guarded read')
            self.tables[name] = {'decoded': decoded, 'original': original, 'rows': decoded['data'][combat_audio_bundle.TABLES[name]],
                                 'identity': {'path': decoded['source'], 'sha256': decoded['sourceSha256']}}
        return self.tables[name]

    def table_pins(self, name):
        table = self.table(name)
        if 'pins' not in table:
            folder = self.lane_folder / ACTOR_SOUND_TABLES_FOLDER / table['identity']['sha256']
            table['pins'] = {'original': self.immutable_input(folder / f'{name}.dat', table['original']),
                             'decoded': self.immutable_input(folder / f'{name}.json', json_bytes(table['decoded']))}
        return table['pins']

    def immutable_input(self, path, payload):
        if path.exists():
            if path.read_bytes() != payload:
                raise ActorSoundConversionError(f'lane work input {path} differs from the decoded source; remove it to redo it')
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
        return {'path': self.repository_relative(path), 'bytes': len(payload), 'sha256': sha256_hex_digest(payload)}

    def required_data_ui_table_manifest(self, name):
        manifest = data_ui_table_manifest(self.project_root, name)
        if manifest is None:
            raise ActorSoundConversionError(f'the {DATA_UI_LANE_NAME} lane catalog holds no single {name} tables record')
        if manifest['sourceSha256'] != self.table(name)['identity']['sha256']:
            raise ActorSoundConversionError(f'the {DATA_UI_LANE_NAME} {name} manifest is not decoded from the client table')
        return manifest

    def routes(self, name):
        if name not in self.routes_by_table:
            manifest = self.required_data_ui_table_manifest(name)
            rows = manifest['records'][combat_audio_bundle.TABLES[name]]
            _, layout, _ = interlude_table_layout(name)
            route_manifest = combat_route_table_manifest(name, manifest['descriptorSha256'], layout, rows, self.is_sound_package_reference)
            self.routes_by_table[name] = bind_combat_role_routes(route_manifest, self.route_proof, self.route_recipe)
        return self.routes_by_table[name]

    def sound_package(self, reference):
        paths = self.package_census.resolve_package_paths(reference, SOUND_PACKAGE_SUFFIXES)
        if len(paths) != 1:
            return None
        if paths[0] not in self.packages:
            _, package = self.converter.package(paths[0])
            exports = [item for item in package.exports if item['className'] == 'Sound']
            admissible = all(item.get('classObject') == SOUND_CLASS_OBJECT and REFERENCE.fullmatch(item['object']) for item in exports)
            self.packages[paths[0]] = {'path': paths[0], 'package': package, 'exports': exports if admissible else None}
        return self.packages[paths[0]]

    def inventory_row(self, package_record, export):
        package = package_record['package']
        identity = {'relativePath': package_record['path'], 'sha256': package.source_hash, 'bytes': len(package.data)}
        return {'stableId': f'{self.client_access.lock.document["referenceHost"]}:{package.source_hash}:{export["exportIndex"]}',
                'id': 'interlude:' + export['object'], 'sourcePackage': identity, 'status': UNCONVERTED_SOURCE_STATUS,
                'export': {key: export[key] for key in ('object', 'className', 'classObject', 'exportIndex', 'offset', 'size')}}

    def bound_references(self, actor_rows):
        references = []
        for actor_row in actor_rows:
            row = self.actor_table_row(actor_row)
            for route in bound_route_records(self.routes(actor_row['table'])):
                references += [reference for reference in decoded_string_values(row.get(route['fieldName'])) if reference]
        return references

    def actor_table_row(self, actor_row):
        rows = self.table(actor_row['table'])['rows']
        found = [row for row in rows if all(row.get(item['pointer'].lstrip('/')) == item['value'] for item in actor_row['match'])]
        if len(found) != 1:
            raise ActorSoundConversionError(f'{actor_row["table"]} holds {len(found)} rows for {actor_row["match"]}')
        return found[0]

    def sound_unit_work(self, package_record, export, inventory_row):
        request = {'kind': 'audio', 'package': package_record['path'], 'object': export['object']}
        inputs = locked_input_records([package_record['path']])
        config = {'request': request, 'stableId': inventory_row['stableId'], 'converterSha256': self.converter_implementation_sha256,
                  'umodelSha256': UMODEL_SHA256}
        unit_key = f'{SOUND_UNIT_KEY_PREFIX}{package_record["package"].source_hash}:{export["exportIndex"]}'
        return SoundUnitWork(unit_key, self.sound_ledger.unit_fingerprint([record['sha256'] for record in inputs], config), request, inputs, config)

    def sound_outcome(self, unit_key):
        return json.loads((self.sound_ledger.unit_step_directory(unit_key) / SOUND_OUTCOME_FILE_NAME).read_bytes())

    def sealed_sound_outcome(self, package_record, export, inventory_row):
        work = self.sound_unit_work(package_record, export, inventory_row)
        return self.sound_outcome(work.unit_key) if self.sound_ledger.is_sealed(work.unit_key, work.fingerprint) else None

    def sound_unit(self, package_record, export, inventory_row):
        work = self.sound_unit_work(package_record, export, inventory_row)
        if not self.sound_ledger.is_sealed(work.unit_key, work.fingerprint):
            step_directory = self.sound_ledger.begin(work.unit_key, work.fingerprint)
            outcome = self.converted_sound_outcome(package_record, export, work.request, step_directory)
            (step_directory / SOUND_OUTCOME_FILE_NAME).write_bytes(canonical_json_bytes(outcome))
            outputs = [file_output_record(self.lane_folder, path) for path in sorted(step_directory.iterdir())
                       if path.name in (NATIVE_PAYLOAD_FILE_NAME, CONVERTED_ARCHIVE_FILE_NAME, CONVERTED_AUDIO_FILE_NAME, SOUND_OUTCOME_FILE_NAME)]
            self.sound_ledger.seal(work.unit_key, work.fingerprint, {'config': work.config, 'inputs': work.inputs, 'outputs': outputs, 'gapRows': []})
        return self.sound_outcome(work.unit_key)

    def converted_sound_outcome(self, package_record, export, request, step_directory):
        try:
            payload, native = sound_payload(package_record['package'], export)
            result = self.converter.convert(request)
            with zipfile.ZipFile(result['file']) as archive:
                asset = json.loads(archive.read('asset.json'))
                metadata = json.loads(archive.read('provenance.json'))['metadata']
                audio = archive.read(asset['audio']['file'])
            if not (asset['audio']['file'] == CONVERTED_AUDIO_FILE_NAME and metadata.get('encodedAudioUnchanged') is True and audio == payload):
                raise ValueError('converted audio is not the unchanged native WAV payload')
        except ReferenceClientLockError:
            raise
        except ValueError as error:
            return {'status': 'refused', 'reason': CONVERTER_REFUSED_REASON_PREFIX
                    + path_free_reason(str(error), self.client_access.root, self.converter.output)}
        (step_directory / NATIVE_PAYLOAD_FILE_NAME).write_bytes(payload)
        shutil.copyfile(result['file'], step_directory / CONVERTED_ARCHIVE_FILE_NAME)
        (step_directory / CONVERTED_AUDIO_FILE_NAME).write_bytes(audio)
        return {'status': 'converted', 'nativeSound': native, 'archiveSha256': sha256_hex_digest((step_directory / CONVERTED_ARCHIVE_FILE_NAME).read_bytes()),
                'audioMetadata': metadata, 'stepDirectory': lane_relative(self.lane_folder, step_directory)}

    def corpus_documents(self, references, sound_outcome):
        inventory_rows, coverage_rows, converter_reasons, package_paths = {}, [], {}, set()
        for reference in references:
            package_record = self.sound_package(reference)
            if package_record is None or package_record['exports'] is None:
                continue
            package_paths.add(package_record['path'])
            rows = [self.inventory_row(package_record, export) for export in package_record['exports']]
            for row in rows:
                inventory_rows.setdefault(row['stableId'], row)
            status, candidates = reference_candidates(reference, rows)
            if status not in combat_audio_bundle.ADMITTED or len(candidates) != 1:
                continue
            candidate = inventory_rows[candidates[0]['stableId']]
            if candidate['status'] != UNCONVERTED_SOURCE_STATUS:
                continue
            export = next(item for item in package_record['exports'] if item['exportIndex'] == candidate['export']['exportIndex'])
            outcome = sound_outcome(package_record, export, candidate)
            if outcome is None:
                return None
            if outcome['status'] != 'converted':
                converter_reasons[candidate['stableId']] = outcome['reason']
                continue
            coverage_rows.append(self.converted_coverage_row(candidate, outcome))
        inventory = {'schemaVersion': 1, 'kind': 'native-staged-sound-inventory', 'sounds': sorted(inventory_rows.values(), key=lambda row: row['stableId'])}
        return inventory, coverage_rows, converter_reasons, sorted(package_paths)

    def converted_coverage_row(self, candidate, outcome):
        folder = outcome['stepDirectory']
        payload = (self.lane_folder / folder / NATIVE_PAYLOAD_FILE_NAME).read_bytes()
        candidate.update(status='source-ready', nativeSound=outcome['nativeSound'],
                         nativePayload={'path': f'{folder}/{NATIVE_PAYLOAD_FILE_NAME}', 'bytes': len(payload), 'sha256': sha256_hex_digest(payload)},
                         serializedExport={'offsetUnwrapped': candidate['export']['offset'], 'bytes': candidate['export']['size'],
                                           'sha256': outcome['nativeSound']['serializedExportSha256']})
        archive = (self.lane_folder / folder / CONVERTED_ARCHIVE_FILE_NAME).read_bytes()
        return {'stableId': candidate['stableId'], 'status': 'exported-and-verified', 'contentSha256': sha256_hex_digest(archive), 'products': {
            'archive': {'path': f'{folder}/{CONVERTED_ARCHIVE_FILE_NAME}', 'bytes': len(archive), 'sha256': sha256_hex_digest(archive)},
            'audio': {'path': f'{folder}/{CONVERTED_AUDIO_FILE_NAME}', 'bytes': len(payload), 'sha256': sha256_hex_digest(payload),
                      'mime': 'audio/wav', 'metadata': outcome['audioMetadata']}}}

    def bundle_work(self, bundle_key, actor_rows, sound_outcome):
        tables = sorted({actor_row['table'] for actor_row in actor_rows})
        routes_by_table = {table: self.routes(table) for table in tables}
        corpus = self.corpus_documents(self.bound_references(actor_rows), sound_outcome)
        if corpus is None:
            return None
        inventory, coverage_rows, converter_reasons, package_paths = corpus
        inputs = locked_input_records(sorted({self.table(table)['identity']['path'] for table in tables} | set(package_paths)))
        config = {'bundleKey': bundle_key, 'actorRows': actor_rows, 'routes': routes_by_table, 'inventorySha256': sha256_hex_digest(json_bytes(inventory)),
                  'coverage': coverage_rows, 'converterReasons': converter_reasons, 'builderSha256': self.combat_audio_builder_sha256}
        fingerprint = self.bundle_ledger.unit_fingerprint([record['sha256'] for record in inputs], config)
        return BundleWork(tables, routes_by_table, inventory, coverage_rows, converter_reasons, inputs, config, fingerprint)

    def receipt_sealed_with(self, bundle_key, fingerprint):
        receipt = self.bundle_ledger.sealed_receipt(bundle_key)
        return receipt if receipt is not None and receipt['fingerprint'] == fingerprint else None

    def sealed_bundle_receipt(self, bundle_key, actor_rows):
        work = self.bundle_work(bundle_key, actor_rows, self.sealed_sound_outcome)
        return None if work is None else self.receipt_sealed_with(bundle_key, work.fingerprint)

    def convert_bundle(self, bundle_key, actor_rows):
        work = self.bundle_work(bundle_key, actor_rows, self.sound_unit)
        sealed_receipt = self.receipt_sealed_with(bundle_key, work.fingerprint)
        if sealed_receipt is not None:
            return self.bundle_outcome(bundle_key, sealed_receipt, True), bundle_store_state(bundle_key, sealed_receipt)
        step_directory = self.bundle_ledger.begin(bundle_key, work.fingerprint)
        evidence = lane_relative(self.lane_folder, step_directory / RECEIPT_RECORD_NAME)
        manifest, outputs, refusal = self.built_bundle(bundle_key, actor_rows, work.routes_by_table, work.inventory, work.coverage_rows, step_directory)
        identities = {table: self.table(table)['identity'] for table in work.tables}
        gap_rows = actor_sound_gap_rows(bundle_key, actor_rows, work.routes_by_table, manifest, identities, evidence, work.converter_reasons)
        if refusal is not None:
            gap_rows.append(actor_sound_gap_row(bundle_key, refusal, dict(identities[work.tables[0]]), evidence))
        (step_directory / 'unresolved-references.json').write_bytes(canonical_json_bytes(unresolved_reference_entries(manifest, work.converter_reasons)))
        outputs.append(file_output_record(self.lane_folder, step_directory / 'unresolved-references.json'))
        receipt = self.bundle_ledger.seal(bundle_key, work.fingerprint,
                                          {'config': work.config, 'inputs': work.inputs, 'outputs': outputs, 'gapRows': gap_rows})
        return self.bundle_outcome(bundle_key, receipt, False), bundle_store_state(bundle_key, receipt)

    def names_no_sound(self, actor_row):
        return not any(reference for _, _, reference in npc_sound_references(self.actor_table_row(actor_row)))

    def no_sound_bundle_work(self, no_sound_bundle):
        inputs = locked_input_records([no_sound_bundle.source_table_identity['path']])
        config = {'bundleKey': no_sound_bundle.key, 'actorRows': [], 'reason': no_sound_bundle.reason,
                  'sourceTableIdentity': no_sound_bundle.source_table_identity, **no_sound_bundle.detail}
        return inputs, config, self.bundle_ledger.unit_fingerprint([record['sha256'] for record in inputs], config)

    def sealed_no_sound_bundle_receipt(self, no_sound_bundle):
        _, _, fingerprint = self.no_sound_bundle_work(no_sound_bundle)
        return self.receipt_sealed_with(no_sound_bundle.key, fingerprint)

    def convert_no_sound_bundle(self, no_sound_bundle):
        inputs, config, fingerprint = self.no_sound_bundle_work(no_sound_bundle)
        sealed_receipt = self.receipt_sealed_with(no_sound_bundle.key, fingerprint)
        if sealed_receipt is not None:
            return self.bundle_outcome(no_sound_bundle.key, sealed_receipt, True), bundle_store_state(no_sound_bundle.key, sealed_receipt)
        step_directory = self.bundle_ledger.begin(no_sound_bundle.key, fingerprint)
        evidence = lane_relative(self.lane_folder, step_directory / RECEIPT_RECORD_NAME)
        gap_row = actor_sound_gap_row(no_sound_bundle.key, no_sound_bundle.reason, dict(no_sound_bundle.source_table_identity), evidence)
        receipt = self.bundle_ledger.seal(no_sound_bundle.key, fingerprint, {'config': config, 'inputs': inputs, 'outputs': [], 'gapRows': [gap_row]})
        return self.bundle_outcome(no_sound_bundle.key, receipt, False), bundle_store_state(no_sound_bundle.key, receipt)

    def built_bundle(self, bundle_key, actor_rows, routes_by_table, inventory, coverage_rows, step_directory):
        inventory_bytes = canonical_json_bytes(inventory)
        coverage = {'schemaVersion': 1, 'kind': 'native-staged-sound-coverage', 'inventorySha256': sha256_hex_digest(inventory_bytes), 'sounds': coverage_rows}
        documents = {'inventory.json': inventory_bytes, 'coverage.json': canonical_json_bytes(coverage)}
        for name, payload in documents.items():
            (step_directory / name).write_bytes(payload)
        recipe_inputs = {'corpus': {'root': self.repository_relative(self.lane_folder),
                                    **{name.removesuffix('.json'): self.input_pin(step_directory / name) for name in documents}},
                         'tables': {table: self.table_pins(table) for table in routes_by_table}}
        recipe = build_actor_sound_recipe(bundle_key, actor_rows, [self.actor_table_row(actor_row) for actor_row in actor_rows], routes_by_table,
                                          recipe_inputs)
        outputs = [file_output_record(self.lane_folder, step_directory / name) for name in documents]
        if recipe is None:
            return None, outputs, None
        recipe_path = step_directory / 'recipe.json'
        recipe_path.write_bytes(json_bytes(recipe))
        outputs.append(file_output_record(self.lane_folder, recipe_path))
        try:
            manifest, payloads, _ = combat_audio_bundle.prepare(self.project_root, recipe_path)
            bundle_folder = self.store_root / COMBAT_AUDIO_STORE_FOLDER / sha256_hex_digest(payloads['manifest.json'])
            combat_audio_bundle.run(self.project_root, recipe_path, bundle_folder)
        except ReferenceClientLockError:
            raise
        except ValueError as error:
            return None, outputs, CONVERTER_REFUSED_REASON_PREFIX + path_free_reason(str(error), self.client_access.root, self.lane_folder)
        outputs.append(file_output_record(self.lane_folder, bundle_folder / 'manifest.json'))
        return manifest, outputs, None

    def input_pin(self, path):
        payload = path.read_bytes()
        return {'path': self.repository_relative(path), 'bytes': len(payload), 'sha256': sha256_hex_digest(payload)}

    def bundle_outcome(self, bundle_key, receipt, cache_hit):
        manifests = combat_audio_manifest_outputs(receipt)
        manifest = json.loads(self.bundle_ledger.lane_output_path(manifests[0]['path']).read_bytes()) if manifests else None
        return {'key': bundle_key, 'step': ACTOR_SOUND_STEP, 'status': 'gap' if receipt['gapRows'] else 'pass',
                'reason': receipt['gapRows'][0]['reason'] if receipt['gapRows'] else None, 'cacheHit': cache_hit,
                'bundleId': actor_sound_bundle_id(bundle_key) if manifests else None, 'references': actor_sound_reference_counts(manifest)}

