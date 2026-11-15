"""Exact reviewed UE2 123/28 and 123/30 AnalogTrack keys from UEViewer UnMesh2.h.

No frame resampling, root-motion removal, pose grounding, or height fitting.
"""
import math
import struct
from collections import Counter
from native_catalog.ue2 import Reader, FormatError, animation_layout


def read_track(reader):
    flags = reader.number('I')
    def array(width):
        count = reader.count(1_000_000)
        rows = list(struct.iter_unpack('<' + 'f' * width, reader.take(count * width * 4)))
        if not all(math.isfinite(value) for row in rows for value in row):
            raise FormatError('Non-finite native animation key')
        return rows
    rotations, translations, times = array(4), array(3), array(1)
    times = [row[0] for row in times]
    if any(right <= left for left, right in zip(times, times[1:])):
        raise FormatError('Native key times are not strictly increasing')
    for keys in (rotations, translations):
        if times and len(keys) not in (0, 1, len(times)):
            raise FormatError('Native key/time counts do not match')
    return {'flags': flags, 'rotations': rotations, 'translations': translations, 'times': times}


def decode_tracks(package, animation):
    animation_layout(package.summary)
    results = []
    for motion in animation['motionMetadata']:
        reader = Reader(package.data, motion['offset'] + 24, motion['offset'] + motion['bytes'])
        indices = [reader.number('i') for _ in range(reader.count(4096))]
        tracks = [read_track(reader) for _ in range(reader.count(4096))]
        root = read_track(reader)
        if reader.position != reader.end or len(tracks) != len(animation['bones']):
            raise FormatError('Native motion is not fully consumed or has a different bone count')
        results.append({'boneIndices': indices, 'tracks': tracks, 'rootTrack': root})
    return results


def add_animations(document, package, item):
    animation = package.animation(item)
    motions = decode_tracks(package, animation)
    joints = document.data['skins'][0]['joints']
    bone_map = {}
    for index, bone in enumerate(animation['bones']):
        key = bone['name'].casefold()
        bone_map.setdefault(key, []).append(index)
    # Fighter.MFighter_anim misspells its right Finger01 as left Finger01.
    # Match names and already-mapped parents, resolving this duplicate only at
    # the same bone index with the same parent. Weapon/shield siblings have
    # different array order, so using indices for every bone would be wrong.
    joint_indices = {node: index for index, node in enumerate(joints)}
    parents = {child: parent for parent, node in enumerate(document.data['nodes']) for child in node.get('children', [])}
    source_counts = Counter(bone['name'].casefold() for bone in animation['bones'])
    corrections = []
    mapping = []
    used = set()
    for index, joint in enumerate(joints):
        mesh_name = document.data['nodes'][joint]['name']
        key = mesh_name.casefold()
        parent = joint_indices.get(parents.get(joint), 0)
        expected_parent = mapping[parent][2] if index else 0
        candidates = [candidate for candidate in bone_map.get(key, []) if candidate not in used and animation['bones'][candidate]['parentIndex'] == expected_parent]
        if not candidates and len(joints) == len(animation['bones']) and index not in used:
            source_bone = animation['bones'][index]
            if source_counts[source_bone['name'].casefold()] > 1 and source_bone['parentIndex'] == expected_parent:
                candidates = [index]
                corrections.append({'index': index, 'sourceName': source_bone['name'], 'meshName': mesh_name, 'parentIndex': parent})
        if len(candidates) != 1:
            raise FormatError(f'Mesh bone has no unique native parent/name mapping: {key}')
        used.add(candidates[0])
        mapping.append((index, joint, candidates[0]))
    output, report = [], []
    for sequence, metadata, motion in zip(animation['sequences'], animation['motionMetadata'], motions):
        clip = {'name': sequence['name'], 'channels': [], 'samplers': [], 'extras': {'nativeFrames': sequence['numFrames'], 'nativeRate': sequence['rate'], 'nativeDurationSeconds': sequence['sourceDurationSeconds']}}
        for mesh_bone, node, animation_bone in mapping:
            track = motion['tracks'][animation_bone]
            for kind, width, keys in [('translation', 3, track['translations']), ('rotation', 4, track['rotations'])]:
                if not keys:
                    continue
                time_scale = sequence['numFrames'] / metadata['trackTime'] if metadata['trackTime'] > 0 else 1
                # UEViewer GetBonePosition evenly spans NumFrames when a
                # native track has no explicit time array. Its glTF exporter
                # incorrectly assumes one key per frame in that special case.
                times = [index * sequence['numFrames'] / len(keys) / sequence['rate'] for index in range(len(keys))] if len(keys) == 1 or not track['times'] else [value * time_scale / sequence['rate'] for value in track['times']]
                if times[0] < 0:
                    raise FormatError('Negative native animation key time')
                if kind == 'translation':
                    values = [(x * .01, z * .01, y * .01) for x, y, z in keys]
                else:
                    # ExportGLTF.cpp TransformRotation swaps Y/Z only. Its
                    # q.W *= -1 line is commented out; applying it would make
                    # animation rotations disagree with exported bind nodes.
                    values = [(x, z, y, w) for x, y, z, w in keys]
                    if mesh_bone == 0:
                        values = [(-x, -y, -z, w) for x, y, z, w in values]
                sampler = len(clip['samplers'])
                clip['samplers'].append({'input': document.accessor([(time,) for time in times], 1, True), 'output': document.accessor(values, width), 'interpolation': 'LINEAR'})
                clip['channels'].append({'sampler': sampler, 'target': {'node': node, 'path': kind}})
        if not clip['channels']:
            raise FormatError('Native animation has no mapped channels')
        output.append(clip)
        report.append({'name': sequence['name'], 'frames': sequence['numFrames'], 'rate': sequence['rate'], 'sourceDurationSeconds': sequence['sourceDurationSeconds'], 'sourceMotionSha256': metadata['sha256'], 'sourceTrackTime': metadata['trackTime'], 'boneIndices': motion['boneIndices'], 'rootSpeed3D': metadata['rootSpeed3D'], 'startBone': metadata['startBone'], 'flags': metadata['flags'], 'auxiliaryRootTrack': motion['rootTrack']})
    document.data['animations'] = output
    return {'animationSet': animation['object'], 'nativeAnimationLayout': animation_layout(package.summary), 'clips': report, 'boneCount': len(joints), 'boneMapping': [{'meshIndex': mesh, 'animationIndex': native} for mesh, _, native in mapping], 'sourceDuplicateNameCorrections': corrections, 'method': 'original-native-AnalogTrack-keys', 'coordinateTransform': '(x,y,z) -> (.01*x,.01*z,.01*y); quaternion (x,y,z,w) -> (x,z,y,w), root conjugated', 'limitations': ['Auxiliary cutscene RootTrack and RootSpeed3D are preserved as metadata; they are not automatically applied as actor movement.', 'Native source duration is retained in clip extras. No synthetic end or loop-seam keys are inserted. Runtime playback must account for native clip duration.']}
