import hashlib
import struct
from typing import NamedTuple

REGISTER_NAMES = ('eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi')
CONDITION_CODES = ('jo', 'jno', 'jb', 'jae', 'je', 'jne', 'jbe', 'ja', 'js', 'jns', 'jp', 'jnp', 'jl', 'jge', 'jle', 'jg')
IMMEDIATE_GROUP_OPERATIONS = {0: 'add', 5: 'sub', 7: 'cmp'}
ACCUMULATOR_IMMEDIATE_OPERATIONS = {0x05: 'add', 0x2d: 'sub', 0x3d: 'cmp'}
MAXIMUM_INSTRUCTION_BYTES = 15
MAXIMUM_CLASS_LITERAL_CHARACTERS = 128
SOULSHOT_BYTE_MASK = 0xac


class SkillDispatchReplayError(ValueError):
    pass


class DecodedInstruction(NamedTuple):
    va: int
    size: int
    mnemonic: str
    operands: tuple


class ReferenceClientBytes(NamedTuple):
    engine_at_va: object
    soulshot: bytes


def signed_byte(value):
    return value - 0x100 if value & 0x80 else value


def unsigned_word(payload, offset):
    return struct.unpack_from('<I', payload, offset)[0]


def signed_word(payload, offset):
    return struct.unpack_from('<i', payload, offset)[0]


def memory_operand(payload, modrm_offset):
    modrm = payload[modrm_offset]
    mode, register, base = modrm >> 6, (modrm >> 3) & 7, modrm & 7
    if mode == 1 and base != 4:
        return register, REGISTER_NAMES[base], signed_byte(payload[modrm_offset + 1]), modrm_offset + 2
    if mode == 2 and base != 4:
        return register, REGISTER_NAMES[base], signed_word(payload, modrm_offset + 1), modrm_offset + 5
    raise SkillDispatchReplayError(f'memory operand form {payload[:modrm_offset + 6].hex()} is outside the replayed forms')


def decode_instruction(payload, va):
    opcode = payload[0]
    if opcode in ACCUMULATOR_IMMEDIATE_OPERATIONS:
        return DecodedInstruction(va, 5, ACCUMULATOR_IMMEDIATE_OPERATIONS[opcode], ('eax', signed_word(payload, 1)))
    if opcode in (0x81, 0x83) and payload[1] >> 6 == 3 and (payload[1] >> 3) & 7 in IMMEDIATE_GROUP_OPERATIONS:
        immediate, size = (signed_word(payload, 2), 6) if opcode == 0x81 else (signed_byte(payload[2]), 3)
        return DecodedInstruction(va, size, IMMEDIATE_GROUP_OPERATIONS[(payload[1] >> 3) & 7], (REGISTER_NAMES[payload[1] & 7], immediate))
    if opcode == 0x8b and payload[1] >> 6 == 3:
        return DecodedInstruction(va, 2, 'mov', (REGISTER_NAMES[(payload[1] >> 3) & 7], REGISTER_NAMES[payload[1] & 7]))
    if opcode in (0x8b, 0x8d):
        register, base, displacement, end = memory_operand(payload, 1)
        return DecodedInstruction(va, end, 'mov' if opcode == 0x8b else 'lea', (REGISTER_NAMES[register], base, displacement))
    if 0x40 <= opcode <= 0x4f:
        return DecodedInstruction(va, 1, 'inc' if opcode < 0x48 else 'dec', (REGISTER_NAMES[opcode & 7],))
    if 0x70 <= opcode <= 0x7f:
        return DecodedInstruction(va, 2, CONDITION_CODES[opcode & 0xf], (va + 2 + signed_byte(payload[1]),))
    if opcode == 0x0f and 0x80 <= payload[1] <= 0x8f:
        return DecodedInstruction(va, 6, CONDITION_CODES[payload[1] & 0xf], (va + 6 + signed_word(payload, 2),))
    if opcode == 0x0f and payload[1] == 0xb6:
        register, base, displacement, end = memory_operand(payload, 2)
        return DecodedInstruction(va, end, 'movzx', (REGISTER_NAMES[register], base, displacement & 0xffffffff))
    if opcode == 0xff and payload[1] == 0x24 and payload[2] >> 6 == 2 and payload[2] & 7 == 5:
        return DecodedInstruction(va, 7, 'jmp-table', (REGISTER_NAMES[(payload[2] >> 3) & 7], unsigned_word(payload, 3)))
    if opcode == 0x68:
        return DecodedInstruction(va, 5, 'push', (unsigned_word(payload, 1),))
    raise SkillDispatchReplayError(f'instruction bytes {payload.hex()} at {va:#x} are outside the replayed forms')


def instruction_at(client_bytes, va, recorded_bytes_hex=None):
    payload = client_bytes.engine_at_va(va, MAXIMUM_INSTRUCTION_BYTES)
    instruction = decode_instruction(payload, va)
    if recorded_bytes_hex is not None and payload[:instruction.size].hex() != recorded_bytes_hex:
        raise SkillDispatchReplayError(f'bytes at {va:#x} are {payload[:instruction.size].hex()}, the recipe records {recorded_bytes_hex}')
    return instruction


def subtract_flags(left, right):
    result = (left - right) & 0xffffffff
    return result, {'ZF': result == 0, 'SF': bool(result & 0x80000000), 'CF': (left & 0xffffffff) < (right & 0xffffffff),
                    'OF': bool((left ^ right) & (left ^ result) & 0x80000000)}


def condition_holds(mnemonic, flags):
    zero, sign, carry, overflow = flags['ZF'], flags['SF'], flags['CF'], flags['OF']
    return {'je': zero, 'jne': not zero, 'jg': not zero and sign == overflow, 'jge': sign == overflow, 'jl': sign != overflow,
            'jle': zero or sign != overflow, 'ja': not carry and not zero, 'jae': not carry, 'jb': carry, 'jbe': carry or zero,
            'js': sign, 'jns': not sign}[mnemonic]


class RegisterMachine:
    def __init__(self, skill_field_offset, skill_value):
        self.skill_field_offset, self.skill_value = skill_field_offset, skill_value
        self.registers, self.flags = {}, None

    def value_of(self, register, instruction):
        if register not in self.registers:
            raise SkillDispatchReplayError(f'{instruction.mnemonic} at {instruction.va:#x} reads {register} before the skill id reaches it')
        return self.registers[register]

    def step(self, instruction):
        operation, operands = instruction.mnemonic, instruction.operands
        if operation == 'mov' and len(operands) == 3:
            if operands[2] != self.skill_field_offset:
                raise SkillDispatchReplayError(f'mov at {instruction.va:#x} reads offset {operands[2]:#x}, not the skill id field')
            self.registers[operands[0]] = self.skill_value
        elif operation == 'mov':
            self.registers[operands[0]] = self.value_of(operands[1], instruction)
        elif operation == 'lea':
            self.registers[operands[0]] = (self.value_of(operands[1], instruction) + operands[2]) & 0xffffffff
        elif operation in ('add', 'sub', 'cmp'):
            right = -operands[1] if operation == 'add' else operands[1]
            result, self.flags = subtract_flags(self.value_of(operands[0], instruction), right)
            if operation != 'cmp':
                self.registers[operands[0]] = result
        elif operation in ('inc', 'dec'):
            result, flags = subtract_flags(self.value_of(operands[0], instruction), 1 if operation == 'dec' else -1)
            self.flags = {**(self.flags or {'CF': False}), 'ZF': flags['ZF'], 'SF': flags['SF'], 'OF': flags['OF']}
            self.registers[operands[0]] = result
        else:
            raise SkillDispatchReplayError(f'{operation} at {instruction.va:#x} has no register meaning here')


def replay_branching_path(client_bytes, instruction_records, branches, skill_field_offset, skill_value):
    machine, branches_by_va, replayed_branches, expected_va = RegisterMachine(skill_field_offset, skill_value), {}, 0, None
    for branch in branches:
        branches_by_va[int(branch['va'], 16)] = branch
    for record in instruction_records:
        instruction = instruction_at(client_bytes, int(record['va'], 16), record['bytesHex'])
        if expected_va is not None and instruction.va != expected_va:
            raise SkillDispatchReplayError(f'the path continues at {expected_va:#x}, the recipe records {instruction.va:#x}')
        expected_va = instruction.va + instruction.size
        if instruction.mnemonic in CONDITION_CODES:
            branch = branches_by_va.get(instruction.va)
            if machine.flags is None or branch is None or int(branch['targetVA'], 16) != instruction.operands[0]:
                raise SkillDispatchReplayError(f'branch at {instruction.va:#x} has no flags or no recorded step')
            taken = condition_holds(instruction.mnemonic, machine.flags)
            if taken != branch['taken']:
                raise SkillDispatchReplayError(f'branch at {instruction.va:#x} computes taken={taken}, the recipe records {branch["taken"]}')
            replayed_branches += 1
            expected_va = instruction.operands[0] if taken else expected_va
        else:
            machine.step(instruction)
    if replayed_branches != len(branches):
        raise SkillDispatchReplayError(f'{replayed_branches} of {len(branches)} recorded branches replayed')
    return expected_va


def table_guard(client_bytes, table):
    guard = {'base': None, 'bound': None, 'selectorTableVA': None, 'targetTableVA': None}
    for record in table['guard']:
        instruction = instruction_at(client_bytes, int(record['va'], 16), record['bytesHex'])
        if instruction.mnemonic in ('sub', 'add'):
            guard['base'] = instruction.operands[1] if instruction.mnemonic == 'sub' else -instruction.operands[1]
        elif instruction.mnemonic == 'lea':
            guard['base'] = -instruction.operands[2]
        elif instruction.mnemonic == 'cmp':
            guard['bound'] = instruction.operands[1]
        elif instruction.mnemonic == 'movzx':
            guard['selectorTableVA'] = instruction.operands[2]
        elif instruction.mnemonic == 'jmp-table':
            guard['targetTableVA'] = instruction.operands[1]
    return guard


def slice_of_kind(table, kind):
    return next((entry for entry in table['slices'] if entry['kind'] == kind), None)


def require_inside_slice(table, kind, index):
    entry = slice_of_kind(table, kind)
    element_bytes = 1 if kind == 'selector-bytes' else 4
    if entry is None or not 0 <= index - entry['firstIndex'] < entry['length'] // element_bytes:
        raise SkillDispatchReplayError(f'{table["id"]} index {index} is outside its pinned {kind} slice')


def table_case(client_bytes, table, selector_value):
    guard = table_guard(client_bytes, table)
    if guard['base'] != table['selectorBase'] or guard['bound'] is None or guard['targetTableVA'] != int(table['targetTableVA'], 16):
        raise SkillDispatchReplayError(f'{table["id"]} guard instructions do not give its base, bound and jump table')
    index = selector_value - guard['base']
    if not 0 <= index <= guard['bound']:
        raise SkillDispatchReplayError(f'{table["id"]} index {index} is outside the guard bound {guard["bound"]}')
    case_index = index
    if table['selectorTableVA'] is not None:
        if guard['selectorTableVA'] != int(table['selectorTableVA'], 16):
            raise SkillDispatchReplayError(f'{table["id"]} selector read names another table')
        require_inside_slice(table, 'selector-bytes', index)
        case_index = client_bytes.engine_at_va(guard['selectorTableVA'] + index, 1)[0]
    require_inside_slice(table, 'jump-targets', case_index)
    return index, case_index, unsigned_word(client_bytes.engine_at_va(guard['targetTableVA'] + 4 * case_index, 4), 0)


def records_by_identifier(recipe):
    return ({record['id']: record for record in recipe['tables']}, {record['id']: record for record in recipe['dispatches']},
            {record['id']: record for record in recipe['helperRoutes']},
            {record['stage']: int(record['skillIdFieldOffset'], 16) for record in recipe['stages']})


def dispatch_case(client_bytes, recipe, dispatch, skill_value):
    tables, _, _, field_offsets = records_by_identifier(recipe)
    end_va = replay_branching_path(client_bytes, dispatch['instructions'], dispatch['branches'], field_offsets[dispatch['stage']], skill_value)
    if dispatch['dispatchKind'] == 'comparison-tree':
        return end_va, None, None
    table = tables[dispatch['tableId']]
    if end_va != int(table['switchVA'], 16):
        raise SkillDispatchReplayError(f'{dispatch["id"]} ends at {end_va:#x}, not at the switch {table["switchVA"]}')
    index, case_index, case_va = table_case(client_bytes, table, skill_value)
    return case_va, index, case_index


def utf16_literal(client_bytes, va):
    payload = client_bytes.engine_at_va(va, 2 * MAXIMUM_CLASS_LITERAL_CHARACTERS)
    end = next((offset for offset in range(0, len(payload), 2) if payload[offset:offset + 2] == b'\0\0'), None)
    if end is None:
        raise SkillDispatchReplayError(f'no NUL-terminated UTF-16 literal at {va:#x}')
    return payload[:end].decode('utf-16-le')


def pushed_literal(client_bytes, push_va, literal_va):
    instruction = instruction_at(client_bytes, push_va)
    if instruction.mnemonic != 'push' or instruction.operands[0] != literal_va:
        raise SkillDispatchReplayError(f'instruction at {push_va:#x} does not push {literal_va:#x}')
    return utf16_literal(client_bytes, literal_va)


def soulshot_line(client_bytes, offset, count):
    return bytes(value ^ SOULSHOT_BYTE_MASK for value in client_bytes.soulshot[offset:offset + count]).decode('ascii')


def class_name_of(client_bytes, binding):
    reference = binding['classReference']
    if reference['kind'] == 'class-literal':
        return pushed_literal(client_bytes, int(binding['classPushVA'], 16), int(binding['classLiteralVA'], 16))
    if reference['kind'] == 'formatted-name-load':
        text = pushed_literal(client_bytes, int(reference['formatPushVA'], 16), int(reference['formatLiteralVA'], 16))
        if text != reference['formatText']:
            raise SkillDispatchReplayError(f'format literal reads {text!r}')
        return text.replace('%d', str(reference['formatArgument']))
    section = soulshot_line(client_bytes, reference['sectionByteOffset'], reference['sectionByteCount']).strip()
    key, _, value = soulshot_line(client_bytes, reference['valueByteOffset'], reference['valueByteCount']).rstrip('\r\n').partition('=')
    if section != f'[{reference["configSection"]}]' or key != reference['configKey']:
        raise SkillDispatchReplayError(f'soulshot.int reads section {section!r} key {key!r}')
    return value


def skill_predicate_case(client_bytes, route, start_va, skill_value):
    machine, location = None, start_va
    for record in route['skillPredicate']:
        instruction = instruction_at(client_bytes, int(record['va'], 16), record['bytesHex'])
        if instruction.va != location:
            raise SkillDispatchReplayError(f'the skill predicate continues at {location:#x}, the recipe records {instruction.va:#x}')
        location = instruction.va + instruction.size
        if machine is None:
            if instruction.mnemonic != 'mov' or len(instruction.operands) != 3:
                raise SkillDispatchReplayError(f'the skill predicate at {instruction.va:#x} does not start with the skill id load')
            machine = RegisterMachine(instruction.operands[2], skill_value)
        if instruction.mnemonic in CONDITION_CODES:
            location = instruction.operands[0] if condition_holds(instruction.mnemonic, machine.flags) else location
        else:
            machine.step(instruction)
    return location


def routed_case(client_bytes, recipe, binding, route, skill_value):
    tables, dispatches, _, _ = records_by_identifier(recipe)
    transient_case, transient_index, transient_case_index = dispatch_case(client_bytes, recipe, dispatches[route['transientDispatchId']],
                                                                          skill_value)
    if transient_case != int(route['transientCaseVA'], 16):
        raise SkillDispatchReplayError(f'{route["routeId"]} transient dispatch reaches {transient_case:#x}')
    if binding['dispatchKind'] != 'cubic-type-table':
        return transient_case, transient_index, transient_case_index
    if binding['selectorValue'] != route['cubicType']:
        raise SkillDispatchReplayError(f'{route["routeId"]} cubic type differs from its binding')
    index, case_index, case_va = table_case(client_bytes, tables[binding['tableId']], binding['selectorValue'])
    if case_va != int(binding['caseVA'], 16):
        raise SkillDispatchReplayError(f'{route["routeId"]} cubic type {binding["selectorValue"]} reaches case {case_va:#x}')
    if binding['resolvedCaseVA'] != binding['caseVA']:
        return skill_predicate_case(client_bytes, route, case_va, skill_value), index, case_index
    return case_va, index, case_index


def level_case(client_bytes, recipe, binding, level):
    tables, _, _, _ = records_by_identifier(recipe)
    _, _, case_va = table_case(client_bytes, tables[binding['levelTable']['tableId']], level)
    recorded = {entry['level']: int(entry['caseVA'], 16) for entry in binding['levelTable']['cases']}
    if recorded.get(level) != case_va:
        raise SkillDispatchReplayError(f'level {level} reaches case {case_va:#x}')
    return case_va


def recompute_candidate_binding(client_bytes, recipe, binding, skill_id, level, index_shift=0):
    skill_value = skill_id + index_shift
    _, dispatches, routes, _ = records_by_identifier(recipe)
    if binding['dispatchId'] is not None:
        case_va, index, case_index = dispatch_case(client_bytes, recipe, dispatches[binding['dispatchId']], skill_value)
    else:
        case_va, index, case_index = routed_case(client_bytes, recipe, binding, routes[binding['routeId']], skill_value)
    recorded_case = int(binding['resolvedCaseVA'] or binding['caseVA'], 16)
    if case_va != recorded_case or (index is not None and (index, case_index) != (binding['selectorIndex'], binding['caseIndex'])):
        raise SkillDispatchReplayError(f'skill {skill_value} reaches case {case_va:#x} index {index} case {case_index}, '
                                       f'the recipe records {recorded_case:#x} index {binding["selectorIndex"]} case {binding["caseIndex"]}')
    if binding['levelTable'] is not None:
        level_case(client_bytes, recipe, binding, level)
    return case_va, class_name_of(client_bytes, binding)


def table_slice_sha256(client_bytes, entry):
    return hashlib.sha256(client_bytes.engine_at_va(int(entry['va'], 16), entry['length'])).hexdigest()
