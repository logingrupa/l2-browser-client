SCHEMA_HASHES = {
    '06_interlude.xml': '5df8b7af1b510daa26008fa4fe91e100253f40161f1f1f9560e3569d539cdef6',
    'dats/skillgrp.xml': 'ad5be4b6daa6c942f1f238de3d77b92b828c97d2d45a4360e4159db199992da1',
    'dats/skillsoundgrp.xml': '373c724ff79e06b9e0b4146618a37c5bb73c86d092cf32ffacada20cb0868284',
    'dats/mobskillanimgrp.xml': 'f94a21d1ead51c6606a95efdffa23257b5aa51ef89adfcb9c62e82267a040079',
    'dats/chargrp.xml': 'e0513aba48dc728e30da8d1630e247f71fe01dc3baaa05c72b87fee32bbeebec',
    'dats/armorgrp.xml': '1729aef2f79ed230b18d4c9b65eabb33c88717b89a97b9f0c02e19abc996d44b',
    'dats/weapongrp.xml': '6f399ff5dbf928e07606bd74b15986df7585bd4af158984529fe7579c319f81d',
    'dats/npcgrp.xml': 'bdb22cce0fb2e9e2abc29714ba425280dba032e51f87ceeccf2c8110e4af9f79',
    'dats/npcname.xml': '18dc3bfb5de2055257e64818d55ca13354694961c08fee50b9b62951eedd681a',
}
CRYPTO_HASH = '600cc9d556c50fb3640075f65a4783bd66e0bd8f7a790b72391b4a2a59004c5b'
TABLES = ('skillgrp', 'skillsoundgrp', 'mobskillanimgrp', 'chargrp', 'armorgrp', 'weapongrp', 'npcgrp', 'npcname')
MTX_DEFINITION_EVIDENCE = {
    'revision': 'f2a2cc16120dd8ffabd60255aaad59fa4d6b6f53',
    'file': 'dat_engine/data/definitions.xml',
    'sha256': 'ac56b72cbec18200b232557623bd9830f176b8819398a8d31d9f84c73daa6076',
    'definition': 'MTX',
}
RGBA_DEFINITION_EVIDENCE = {
    'revision': 'f2a2cc16120dd8ffabd60255aaad59fa4d6b6f53',
    'definition': 'RGBA',
    'files': {
        'dat_engine/src/schema.rs': '3104e3795a7327e98c5a21cc1429b4496fe42d1dedb321376288f3ba3ccb89ac',
        'dat_engine/src/reader.rs': '3b73a029df9ddef76ac3d775da2c2fa03dcce8105189a74d4c0191627f2bde73',
        'dat_engine/src/bytes.rs': '2c20aeccf0dc28d107998be8e27d4281140d5ccbd572c76d6bfcee1abf7038b2',
    },
    'representation': 'Four source-order bytes as eight uppercase hexadecimal characters; no channel reordering or CSS interpretation.',
}
RECORD_IDENTIFIER_FIELDS = {
    'armorgrp': ('item', 'object_id'),
    'weapongrp': ('item', 'object_id'),
    'npcgrp': ('npc', 'npc_id'),
    'npcname': ('npc', 'id'),
}
