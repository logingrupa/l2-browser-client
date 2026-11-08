# Network framing, crypto and session replay

> Reference notes, not decisions. `.planning/PROJECT.md` and `.planning/REQUIREMENTS.md` win where they differ. IDs marked "(proposed)" belong to `plan/autonomous-roadmap` and are not in force until that branch adopts them. Constants with status `unconfirmed` come from C4 binaries and only become native rules after they are re-derived against Interlude. The clean-room, no-vendor and shared-module rules are in [README.md](README.md).

The wire layer between the browser and stock L2J Mobius CT_0 Interlude at 417fd3bc: length framing over our own WebSocket relay, a little-endian packet codec, login and game crypto, dispatch into GameWorldAdapter records, and capture and replay. Lineage2JS shows the shape in a browser, but its constants are C4 and its handlers import three.js. Mobius source is the server truth, and L2.exe captures through a TCP tee are the client truth. The adapter feeds MOVE-01 ([03-movement.md](03-movement.md)) and MAT-02 ([01-materials-fog.md](01-materials-fog.md)).

## Where it fits

- Requirements: `NET-01`, `NET-02`, `NET-03`, `NET-04`, `NET-05`, `NET-06`, `NET-07`, NET-09 (proposed), NET-10 (proposed), `ARCH-01`, `ARCH-02`, `ARCH-03`, `ARCH-04`, `DATA-01`, `DATA-03`
- Phase: Phase 4 Stage B, after Phase 3 (`.planning/ROADMAP.md:111`). Earlier synthetic codec work needs an owner decision recorded in `.planning/PROJECT.md`. The contract commit lands with its first Phase 2 consumer, MOVE-01 or MAT-02. Values sourced only from C4 binaries stay `unconfirmed` until Phase 5 (POL-04).
- Lane: Integration, parts adapter-login and adapter-dispatch. NET-05 to NET-07 reuse the registry. `src/world/mobius/**` carries MOVE-02, whose reporter is world-lane code.

Owned paths:

- `src/net/**` (unclaimed, so integration)
- `src/world/AccountSession.ts` and `src/world/mobius/**` (integration)
- `src/runtime/**` transport, NetClock and session wiring (integration)
- `tools/net-relay/**` and `tools/reference-overlap/**` (unclaimed, so integration)
- `docs/parts/adapter-login/**` and `docs/parts/adapter-dispatch/**` (integration)
- `tests/unit/net/**`, `tests/unit/importBoundaries.net.test.ts` and `tests/fixtures/net/**` (shared by all lanes)
- The Vite dev proxy entry and `.gitignore` lines (integration)

## What the reference shows

| Topic | Where | What it shows |
|---|---|---|
| Citation prefixes | `mobius/` = `L2J_Mobius_CT_0_Interlude/java/org/l2jmobius/`, `mobius-dist/` = `L2J_Mobius_CT_0_Interlude/dist/`, `elbera-gateway/` = Lineage2Elbera `gateway/` at 12c9656 | Mobius is upstream MobiusDevelopment/L2J_Mobius at 417fd3bc13da66184ad4ec1db66c5b598e06bfb8 with MIT headers (`mobius/gameserver/network/Encryption.java:1-20`). Cite it and write our own code. The gateway is a behaviour reference only, unlike the vendored world-owned `scripts/vendor/lineage2elbera_bsp/`. |
| Replay | `lineage2js/src/network/l2-replay-file.ts:4-198`, `lineage2js/src/network/l2-replay-recorder.ts:5-92`, `lineage2js/src/network/game-client.ts:74-161` | The .l2r layout, cap, whitelist and playback through the live path. |
| BigInt modpow | `l2js-core/src/crypto/decryption/decoders.ts:5-20` | 1024-bit BigInt modpow runs in the browser. |
| Elbera gateway | `elbera-gateway/test/packet-framing.test.js`, `elbera-gateway/test/login-lifecycle.test.js`, `elbera-gateway/src/crypt.js:188,196` | Edge cases from a Node gateway against aCis, whose design `.planning/PROJECT.md:36` excludes. Its RSA uses Node crypto.publicEncrypt, which a browser lacks. |

## Behaviour to implement

### Transport and routes

The browser opens one WebSocket per L2 connection (`binaryType` arraybuffer) to a relay route, `/login` or `/game/<serverId>`. The relay pipes bytes unchanged to one allowlisted Mobius port. Message boundaries mean nothing, and a text message is fatal. The route comes from relay configuration, never from ServerList as in the reference (`lineage2js/src/network/login-client.ts:194-196`). Mobius picks the advertised address per connecting subnet (`mobius/loginserver/network/serverpackets/ServerList.java:92`, `mobius-dist/game/config/default-ipconfig.xml`), so behind a relay it shows the relay's network. We only display it.

### Framing

A frame is a u16le length `L` that counts its own 2 bytes, then `L - 2` body bytes. Crypto touches bodies only. After each chunk, over the pending bytes:
1. While 2 or more bytes are pending, read `L`.
2. `L < 2` raises FramingError and closes. Mobius skips 0 to 2 as keep-alives (`mobius/commons/network/handler/ReadHandler.java:106-113`) but never sends `L < 2`.
3. `L == 2`: drop the empty frame and count it.
4. Fewer than `L` bytes pending: wait.
5. Otherwise cut the body and loop.

`push(chunk)` returns all bodies and dispatch runs after the cut, so one handler failure never strands later frames. The reference dispatches inside the loop (`lineage2js/src/network/l2-socket.ts:57-72`). Encoding: `L = body + 2`, body at most 65533 bytes, since Mobius disconnects only above that (`ReadHandler.java:115-120`). A close mid-frame discards pending bytes.

### Packet codec and tail rules

Fields are little-endian: `c` u8, `h` u16, `d` i32, `q` i64 as bigint, `f` f64, `b(n)` n bytes, `S` UTF-16LE through a 0x0000 unit. Reads check bounds and raise PacketUnderflowError {opcode, offset, need, length}, also for an unterminated string. The reference lacks `q` (`lineage2js/src/network/packet-reader.ts:14-41`), which 16 server and 2 client classes need (row `game-int64-fields`). Grep each Mobius class for writeLong or readLong first.

The writer asserts ranges where the reference wraps (`lineage2js/src/network/packet-writer.ts:6-35`): `c` [-128, 255], `h` [-32768, 65535], `d` [-2^31, 2^32 - 1], `q` [-2^63, 2^64 - 1], `f` finite, `S` without U+0000.

Tails:
- Game decoders end strict. Leftover bytes raise TrailingBytesError unless a named tail with a Mobius cite is declared, as in the reference's strict readers (`lineage2js/src/network/game-packets.ts:1043-1193`).
- Mobius pads every login frame. The stream layer strips the checksum word, or the XOR key slot and last word for Init, and the decoder requires zeros after its layout.
- Padding from L2.exe is reported, not enforced.

### Blowfish

ECB, 8-byte blocks, 16 rounds, an 18-word P array and four 256-entry S-boxes from the hex fraction of pi (row `blowfish-tables`). The key schedule is standard: key bytes cycle big-endian into P, then repeated encryption of a zero block refills P and the S-boxes (`mobius/commons/crypt/BlowfishEngine.java:1164-1222`). The L2 difference is that each 32-bit block half is read and written little-endian (`BlowfishEngine.java:1448-1470`). The reference reverses every 4 bytes around a big-endian library instead (`lineage2js/src/network/l2-crypt.ts:10-45`). Session keys are random bytes, so the schedule uses the full key length and never stops at 0x00.

### Login stream

Mobius uses the static key (row `login-static-key`) for the first server frame only. Every other frame in both directions, the client's AuthGameGuard included, uses the dynamic key and a checksum (`mobius/loginserver/network/LoginEncryption.java:88-111,151-161`). Mobius sizes a frame as `N = (floor((P + h) / 8) + 1) * 8 + 8`, with payload `P` and `h` 8 static or 4 dynamic (`LoginEncryption.java:61-64,118-129`). Init has `P = 170`, so `N = 192`.

Opening the first frame:
1. Require `N mod 8 == 0` and decrypt with the static key.
2. Undo the XOR pass (`mobius/commons/crypt/NewCrypt.java:40-41,183-211`). The server walked LE words `w_p` for `p = 4, 8, ..., N - 12` with a running key `k_p = k_(p-4) + w_p mod 2^32` from a random seed, stored `w_p xor k_p`, and wrote the last key at `N - 8`. Bytes 0 to 3 and the last word are untouched. Invert from `k` = the word at `N - 8`, for `p` from `N - 12` down to 4: plain = stored xor `k`, then `k = k - plain mod 2^32`.
3. There is no checksum. Strip bytes `N - 8` to `N - 1`. The 14 bytes between the payload and `N - 8` must be zero.

Later frames: require `N mod 8 == 0` and `N > 4`, decrypt with the dynamic key, and require the XOR of all LE words in `[0, N - 4)` to equal the word at `N - 4` (`NewCrypt.java:90-162`). A mismatch is a fatal ChecksumError. Mobius also closes on a bad client frame (`mobius/loginserver/network/LoginClient.java:103-112`). Sealing: `N = roundup8(P + 4)`, zero-fill, checksum at `N - 4`, encrypt. Mobius accepts it without its extra 8 bytes.

A banned address gets LoginFail from the LoginClient constructor (`LoginClient.java:90-93`) before Init (`:117`). That frame takes the static key and Init the dynamic key. The opener accepts opcode 0x01, shows the reason and closes the socket itself, because Mobius only sends it (`:259-262`).

### Login packets and sequence

Layouts after the opcode, from `mobius/loginserver/network/clientpackets/` and `serverpackets/`, with line numbers in each class file:

| Dir | Op | Name | Fields |
|---|---|---|---|
| S | 0x00 | Init | `d` sessionId, `d` revision 0xC621, `b128` scrambled modulus, 4 `d` GameGuard values (row `login-init-gg`), `b16` dynamic key, `c` 0 (62-76) |
| C | 0x07 | AuthGameGuard | `d` sessionId, 4 `d` 0; at least 20 bytes (60-74) |
| S | 0x0B | GGAuth | `d` sessionId, 4 `d` 0 (41-46) |
| C | 0x00 | RequestAuthLogin | `b128` RSA block |
| S | 0x03 | LoginOk | `d` k1, `d` k2, `d` 0, `d` 0, `d` 0x3EA, 3 `d` 0, `b16` 0 (68-77) |
| C | 0x05 | RequestServerList | `d` k1, `d` k2 (45-50) |
| S | 0x04 | ServerList | see below |
| C | 0x02 | RequestServerLogin | `d` k1, `d` k2, `c` serverId |
| S | 0x07 | PlayOk | `d` p1, `d` p2 |
| S | 0x06 | PlayFail | `c` reason |
| S | 0x01 | LoginFail | `c` reason |
| S | 0x02 | AccountKicked | `d` reason |

Mobius also declares client 0x0E and 0x0F without handlers and server 0x0D LoginOptFail, 0x11 and 0x12 (`mobius/loginserver/network/LoginClientPackets.java:40-45`, `LoginServerPackets.java:30-41`).

ServerList: `c` count, `c` lastServer, then per server `c` id, 4 `c` IPv4, `d` port, `c` age limit, `c` pvp, `h` players, `h` max players, `c` up, `d` type bits (1 normal, 2 relax, 4 public test, 8 no label, 16 creation restricted, 32 event, 64 free), `c` brackets. A named tail follows: `h` 0, then `c` entry count and per entry `c` serverId, `c` character count, `c` pending-deletion count and that many `d` seconds left, or one `c` 0 when Mobius has no counts (151-202).

Sequence rules:
- A sessionId mismatch in AuthGameGuard gets LoginFail access failed (`AuthGameGuard.java:86-99`).
- With ShowLicence True, LoginOk waits for RequestServerList. With False, ServerList comes directly and RequestServerLogin skips the key check (`RequestServerLogin.java:68`).
- LoginFail and AccountKicked end the session in any state. Any unexpected opcode raises ProtocolError.
- Each step times out, because Mobius stays silent when RSA decryption throws (`RequestAuthLogin.java:86-90`).
- A wrong password gives REASON_USER_OR_PASS_WRONG (`:116-120`). With AutoCreateAccounts True, an unknown account is created.

### RSA credentials

Init carries the modulus scrambled in four steps, without a leading 0x00, so it is always 128 bytes (`mobius/loginserver/controller/ScrambledKeyPair.java:41-75`). No step changes the bytes it reads, so the client runs the same operations in reverse order:

| Server step | Operation | Client order |
|---|---|---|
| 1 | swap bytes 0x00-0x03 with 0x4D-0x50 | 4th |
| 2 | bytes 0x00-0x3F xor= bytes 0x40-0x7F | 3rd |
| 3 | bytes 0x0D-0x10 xor= bytes 0x34-0x37 | 2nd |
| 4 | bytes 0x40-0x7F xor= bytes 0x00-0x3F | 1st |

The 128-byte credentials block is zero except the ASCII account at 0x5E (at most 14 bytes) and the password at 0x6C (at most 16) (`mobius/loginserver/network/clientpackets/RequestAuthLogin.java:103-104`). Mobius trims both and never reads 0x5B (row `login-credentials-marker`). Reject non-ASCII input. Keep the frame below 256 bytes after the opcode, because at 256 Mobius switches to two blocks (`RequestAuthLogin.java:55-67`).

Read the block as a big-endian integer `m`, assert `m < n`, compute `c = m^65537 mod n` by BigInt square-and-multiply, and write `c` big-endian, left-padded to 128 bytes. Mobius keys are 1024-bit and unpadded, with 10 cached pairs (`mobius/loginserver/controller/LoginController.java:88-98`). WebCrypto has no unpadded RSA. Drop the password once the block exists.

### Game stream

1. The client sends ProtocolVersion 0x00 in plain with `d` 746 (row `game-protocol`). Version -2 is the status ping, and Mobius disconnects at once (`mobius/gameserver/network/clientpackets/ProtocolVersion.java:56-60`).
2. KeyPacket 0x00 arrives plain: `c` result (0 wrong protocol, 1 ok), `b8` key, `d` encryption flag, `d` serverId, `c` 1, `d` obfuscation key 0 (`mobius/gameserver/network/serverpackets/KeyPacket.java:42-52`). On result 0 Mobius closes about 1 s later (`mobius/gameserver/network/GameClient.java:127-141`).
3. Key `K` is bytes 0 to 7 from KeyPacket plus row `game-key-tail`, one copy per direction.
4. Per body, with byte index `i` from 0: `c_i = p_i xor K[i mod 16] xor c_(i-1)` with `c_(-1) = 0`, so `p_i = c_i xor K[i mod 16] xor c_(i-1)`. After each body of length `n`, add `n` mod 2^32 to the LE word at `K[8..11]` of that direction (`mobius/gameserver/network/Encryption.java:41-49,92-171`).
5. KeyPacket and ProtocolVersion stay plain. The first encrypt call only switches the cipher on (`Encryption.java:94-98`).
6. Flag 0 keeps the session plain. Stock Mobius ships PacketEncryption False (`GameClient.java:101-120,143-153`), retail runs it on.

A second KeyPacket raises ProtocolError. C4 uses an 8-byte key, `i mod 8` and the counter at bytes 0 to 3 (`lineage2js/src/network/l2-crypt.ts:139-185`).

### Game entry and connection states

| Step | Client sends | Server answers |
|---|---|---|
| 1 | ProtocolVersion 0x00 | KeyPacket 0x00 |
| 2 | AuthLogin 0x08: `S` account, `d` p2, `d` p1, `d` k1, `d` k2 | CharSelectInfo 0x13 |
| 3 | CharacterSelect 0x0D: `d` slot, `h`, `d`, `d`, `d` | ServerClose 0x26, SystemMessage 0x64 or others, then CharSelected 0x15 |
| 4 | EnterWorld 0x03 (row `game-enterworld-body`) | UserInfo 0x04 and the world stream |

Sources: `mobius/gameserver/network/clientpackets/AuthLogin.java:42-57` (lower-cases the name, closes on an empty one), `CharacterSelect.java:75-79,124-173,218-219`. Game opcodes come from `mobius/gameserver/network/ClientPackets.java:37-193` and `ServerPackets.java:32-188` unless marked C4.

Mobius gates every client opcode by connection state and silently drops out-of-state packets, Ex included (`ClientPackets.java:37-197`, `mobius/gameserver/network/GamePacketHandler.java:56-75`). ENTERING accepts only EnterWorld (`ClientPackets.java:46`). Our state machine is the authority, since no server error comes back.

GameGuardReply 0xCA sets a flag that no code reads (`GameGuardReply.java:76-80`), so our client does not send it (row `game-gameguard`). RequestNetPing 0xA8 has no fields and gets NetPing 0xD3 `d` game time (`RequestNetPing.java:33-46`). L2.exe's ping cadence needs a long capture.

### Dispatch

The opcode is a `c`. Server Ex packets are 0xFE plus an `h` sub (`mobius/gameserver/network/ServerPackets.java:318-334`), client Ex packets 0xD0 plus an `h` sub (`GamePacketHandler.java:56-59`). Interlude Ex ids start at `ServerPackets.java:231`, so the C4 enum does not apply. A registry maps (opcode, sub) to a decoder that yields a typed record in source units, and a handler maps the record to WorldEvents. `src/net/game/opcodes.ts` holds the full Interlude tables from `ServerPackets.java`, `ClientPackets.java` and `ExClientPackets.java`, one cite per row.
- An opcode missing from the table is drift: a ProtocolError diagnostic, and the packet is dropped.
- A tabled opcode with no decoder counts as `net-class-unported:<MobiusClass>`, an undecoded declared tail as `net-feature-unported:<MobiusClass>.<field>`. The reference falls through silently (`lineage2js/src/network/network-manager.ts:941-942`).
- A decode error drops that packet only. Ciphers stay in step, because decryption runs per frame before decoding.
- Framing, checksum and KeyPacket errors close the connection visibly (ARCH-03).

The reference's domain split (session, actors, movement, combat, items, community) is usable.

### Movement packets

Opcodes 0x2E, 0x36, 0x60 and 0x61 and all field orders below are C4 (`lineage2js/src/network/game-packets.ts:86,123-124,341`; table line numbers are in `lineage2js/src/network/network-movement.ts`). Check each against its Mobius class and row first, because MoveToPawn and TeleportToLocation tails vary by chronicle.

| Server packet | C4 fields | Event |
|---|---|---|
| CharMoveToLocation 0x01 | `d` objectId, `d` x y z destination, `d` x y z origin (79-87) | `move` |
| MoveToPawn 0x60 | `d` objectId, `d` targetId, `d` distance, then locations (C4 reads two, 110-113) | `move` with `targetId`, `offset` = distance |
| StopMove 0x47 | `d` objectId, `d` x y z, `d` heading (155-161) | `stop` |
| ValidateLocation 0x61 | `d` objectId, `d` x y z, `d` heading (174-180) | `correct` |
| TeleportToLocation 0x28 | `d` objectId, `d` x y z, a C4 `d` flag (200-206) | `teleport` |
| ChangeMoveType 0x2E | `d` objectId, `d` running, `d` (`network-manager.ts:765`) | stored, then a full update |

Positions are wire integers in source units, and headings are masked to 16 bits. From the latest UserInfo, CharInfo or NpcInfo, `moveType` takes the running flag (or ChangeMoveType), `speeds` the speed `d` fields and movement multiplier `f` unchanged, and `collision {radius, height}` the `f` collision fields.

Intents leave as these packets (row `move-report-rounding`):

| Intent | Packet | Fields |
|---|---|---|
| `move-local {target, origin}` | MoveToLocation 0x01 (Lineage2JS MoveBackwardToLocation) | `d` round(target), `d` round(origin), `d` move mode, 1 mouse, 0 keys (`mobius/gameserver/network/clientpackets/MoveToLocation.java:49-55`) |
| `report-position {position, heading}` | ValidatePosition 0x48 | `d` trunc(x y z), `d` heading, `d` vehicleId 0 |
| `cannot-move {position, heading}` | CannotMoveAnymore 0x36 | `d` round(x y z), `d` heading |

Intent coordinates are the float32 source Location from the MOVE-01 core. JS `Math.round` takes halves toward +infinity, so a capture with negative halves settles L2.exe's rule. Cadence and the stuck rule belong to the MOVE-02 reporter ([03-movement.md](03-movement.md)).

### Game time

The adapter emits `environment {gameMinutes, environmentType}` as values, not a clock. MAT-02 advances time between updates at the Env.int TimeRatio ([01-materials-fog.md](01-materials-fog.md)).
1. CharSelected 0x15 carries the game time as a `d` near its end, which the reference reads as game minutes (`lineage2js/src/network/game-packets.ts:690-704`, `lineage2js/src/network/network-session.ts:284`). Interlude offsets differ, because exp is 64-bit (`mobius/gameserver/network/serverpackets/CharSelected.java:60`).
2. AccountSession passes the value on, and the adapter emits `environment` in its first advance().
3. SunRise 0x1C and SunSet 0x1D (C4 numbering, `game-packets.ts:69-70`) carry no fields in the reference and emit the snaps in row `game-sun-snaps`.
4. Any other Mobius class that writes the game clock (grep `mobius/gameserver/network/serverpackets/` for the game-time manager) is decoded the same way.
5. `environmentType` stays 0, materials' fallback, until its source is known. With no server time, materials starts at StartTime=12.

### Capture and replay

Capture is wire-level only: per connection and direction, {monotonic ms, byte chunk}, recorded at the relay sockets or the browser NetConnection. A deriver gets plain packets through the same framing and stream layers, because the first login frame yields the dynamic key and KeyPacket is plain.

Replay runs on plain packets. A replay channel delivers recorded server packets as a virtual NetClock advances, and checks each client packet against the next recorded one outside listed masks. The harness steps `src/shared/presentationClock.ts` at a fixed `dt` and the virtual NetClock by the same amount. Framing and ciphers get their own raw-frame vectors.

Retail .l2r cannot serve as fixtures: it keeps only whitelisted server packets after the first UserInfo and has no client or login traffic (row `l2r-format`, `lineage2js/src/network/l2-replay-recorder.ts:5-37`). The legacy signature lacks the format dword and user-id block, and the SafePackage trailer is read unvalidated.

## Data inputs

| Input | Produced today by | Gap |
|---|---|---|
| Blowfish tables | None | A BigInt test computes the first 1042 words of pi's hex fraction (Machin formula). Public ECB vectors go to `tests/fixtures/net/blowfish-ecb-vectors.json`. |
| Mobius facts | Humans reading 417fd3bc | The only checkout is outside the repo and dirty (`mobius/gameserver/GameServer.java:443`). Cite a clean upstream clone. |
| Captures | None | Sandbox stock Mobius, a throwaway account, both PacketEncryption settings, with provenance hashes of the Mobius commit, working-tree diff, Server.ini files and ipconfig.xml (rows `login-config` and `game-config`). |
| Unit transform | `src/world/sourceFrame.ts` | None while tiles keep absolute source coordinates (PlayerStart10 round trip in [03-movement.md](03-movement.md)). |
| LoginFail and PlayFail texts | DATA-01, DATA-03 | The Interlude reason-code to systemmsg map. |
| Environment type | None | No known source. |

## Constants

| ID | Value | Provenance | Status | Runtime default |
|---|---|---|---|---|
| login-static-key | `6B 60 CB 5B 82 CE 90 B1 CC 2B 6C 55 6C 6C 6C 6C` | `mobius/loginserver/network/LoginEncryption.java:37-58`; C4 differs (`lineage2js/src/network/l2-crypt.ts:6`) | unconfirmed | First server frame only |
| login-revision | 0x0000C621 | `mobius/loginserver/network/serverpackets/Init.java:65` | unconfirmed | Required on open |
| login-init-gg | 0x29DD954E 0x77C39CFC 0x97ADB620 0x07BDE0F7 | `Init.java:70-73` | unconfirmed | Ignored |
| login-dynamic-key | 16 bytes, then 0x00; pool of 20 random keys; may contain 0x00 | `Init.java:75-76`; `LoginController.java:73,124-136` | unconfirmed | From each Init |
| login-credentials-marker | 0x24 at 0x5B in the reference; Mobius never reads it | `lineage2js/src/network/l2-crypt.ts:129` | unknown | 0x00 |
| login-config | port 2106; LoginTryBeforeBan 5 (per address, no decay, cleared on success or ban, tested >=); LoginBlockAfterBan 900 s; ShowLicence True; AutoCreateAccounts True; FastConnectionLimit 15 and MaxConnectionPerIP 50 guard only game-server registration | `mobius-dist/login/config/Server.ini:22,41,45,53-65,74,77`; `LoginController.java:174-201,233-247`; `mobius/loginserver/GameServerListener.java:45` | unconfirmed | Stock, LoginTryBeforeBan raised above the relay limit |
| game-config | port 7777; GameserverHostname 0.0.0.0; PacketEncryption False; AllowedProtocolRevisions 746 | `mobius-dist/game/config/Server.ini:29,32,39,72`; `mobius/gameserver/GameServer.java:443` | unconfirmed | Stock, hashed into capture provenance |
| game-protocol | 746; C4 sends 660 | `ProtocolVersion.java:56-72`; `lineage2js/src/network/game-packets.ts:3` | unconfirmed | 746 |
| game-key-tail | `C8 27 93 01 A1 6C 31 97` at `K[8..15]` | `mobius/gameserver/network/BlowFishKeygen.java:35-60` | unconfirmed | As value |
| game-int64-fields | server UserInfo, CharSelectionInfo, CharSelected, PetInfo (4), PetStatusUpdate (3), GMViewCharacterInfo, ExEnchantSkillInfo, ExEnchantSkillList, SystemMessage, ConfirmDlg, AcquireSkillInfo, ExPutItemResultForVariationCancel, WareHouseDepositList, WareHouseWithdrawalList, SortedWareHouseWithdrawalList, AdminForgePacket; client RequestPetUseItem, RequestPrivateStoreManageSell | writeLong and readLong in the Mobius packet classes; `UserInfo.java:87` | unconfirmed | `q` |
| game-enterworld-body | 104 bytes: `b32`, 4 `d`, `b32`, `d`, 20 tracert bytes | `EnterWorld.java:126-142`; C4 sends none (`game-client.ts:200`) | unconfirmed | Zero-filled until a capture shows L2.exe's bytes |
| game-gameguard | server 0xF9 GameGuardQuery, 4 `d`, never sent; client 0xCA GameGuardReply, 4 bytes, `d`, 4 bytes, unused | `GameGuardQuery.java:29,38-42`; `GameGuardReply.java:58-81` | unconfirmed | Not sent |
| game-sun-snaps | SunRise 420 game minutes, SunSet 60 | `lineage2js/src/network/network-manager.ts:985-986` (C4 Engine) | unconfirmed | 420 and 60 |
| move-report-rounding | MoveToLocation `round`, ValidatePosition `trunc`, CannotMoveAnymore `round` | `lineage2js/src/network/game-client.ts:233-243` | unconfirmed | `Math.round`, `Math.trunc` |
| blowfish-tables | first 18 + 1024 32-bit words of the hex fraction of pi | Blowfish specification; computed, never copied | unconfirmed | Computed, SHA-256 pinned |
| l2r-format | FString signature, `d` format, `d` version, 62-byte scene header, packet, camera and user-id records, SafePackage trailer; version cap 660; 64 whitelisted indices plus 2 and 74 for chat | `lineage2js/src/network/l2-replay-file.ts:4-6,20-48,112-156` (C4 Engine.dll 0x754f40) | unknown | Not used |
| loginfail-text-map | C4 NWindow table, for example 1 to 448, 2 and 3 to 449 and 450 | `lineage2js/src/network/login-client.ts:41-46` (C4 NWindow 0x1006f1d0) | unknown | Numeric reason shown |

## Interlude differences

| Item | Detail | How to confirm |
|---|---|---|
| Login | C4 reads Init plain and keeps a 21-byte key. Mobius ciphers Init with a 16-byte key after an XOR pass, then switches to the dynamic key. | Init opens to 192 bytes and 0xC621. |
| Login packets | Two RSA blocks from 256 bytes; Mobius ServerList type bits and tail. | L2.exe capture; ServerList with zero leftover. |
| Protocol and cipher | 746, not 660 (other builds use 737, 740 or 744). The KeyPacket flag is obeyed, and the key is 16 bytes. | Captures under both PacketEncryption settings. |
| Layouts | 64-bit fields, a 104-byte EnterWorld, a 12-byte GameGuardReply. A prior study lists ItemList, InventoryUpdate, UserInfo, CharInfo and CharSelectInfo growth, unconfirmed. | Mobius class and capture per decoder. |
| Movement and time | C4 opcodes and field orders. | Mobius row and class; capture for rounding. |
| .l2r and LoginFail texts | From C4 Engine.dll 0x754f40 and NWindow. | Phase 5 (POL-04) against Interlude Engine.dll 4dd2f63c...; DATA-01 systemmsg against L2.exe. |

## Do not copy

- C4 crypto and layouts as Interlude fact: the 21-byte key, the 8-byte XOR, plain Init, the static key forever (`lineage2js/src/network/l2-crypt.ts:6,139-185`, `lineage2js/src/network/login-client.ts:50,68-70`), the KeyPacket flag as an inventory namespace (`lineage2js/src/network/network-manager.ts:688`), ServerList bit 0x02 as showClock (`login-client.ts:180`) and exp as `d` (`lineage2js/src/network/game-packets.ts:666,696,708`).
- The bare EnterWorld and empty GameGuardReply builders (`lineage2js/src/network/game-client.ts:200,427`) and the empty GameGuardQuery reader (`lineage2js/src/network/network-community.ts:856-860`).
- In-loop dispatch, silent opcode fallthrough, silent writer wrapping, three.js in handlers, the ServerList game URL, and the password kept for GM transfer (`lineage2js/src/network/network-session.ts:18-20,194-247`).
- The .l2r cap, the C4 whitelist and the C4 LoginFail map as Interlude facts.
- Reference movement policy as protocol fact: move mode always 1 (`game-client.ts:233-235`), ValidatePosition at most once per 1000 ms while moving (`network-manager.ts:1375-1385`) and the anti-stuck rule (`network-manager.ts:30-36,1386-1408`). Mobius reads move mode 0 for keys and 1 for mouse.
- Any code from Mobius or the Elbera gateway.

## Our code today

Code truth is native-world-slice at 22de53a. Planning truth is plan/autonomous-roadmap at 56bf9f7.
- `src/world/GameWorldAdapter.ts` holds the frozen five methods. No Babylon objects, transport types or wall-clock timers cross it, every update is a complete state, and a transport-backed advance() may be empty.
- `src/world/worldTypes.ts` (plan branch) has WorldEvents spawn, update (optional shouldSnap), despawn and skill-cast, twelve WorldCommands including move-local and spawn-npc, and EntityKind local-player, remote-player or monster.
- `src/world/NativeSliceAdapter.ts:19-24` hard-codes aCis walk 80 and run 115 units/s.
- The contract test requires `local-player` in getInitialState, one synchronous event after spawn-npc, and none after dispose. concreteAdapterModules lists MockWorldAdapter.ts and NativeSliceAdapter.ts.
- No networking or socket, crypto or bignum package exists. Tooling: Node >= 22.12, esbuild 0.28.2, vite 7.3.7, vitest 5.1.0, typescript 7.0.2.
- `docs/PORT_SCOPE.md:93` still plans to port the Elbera gateway, and no committed .gitignore covers `.assets/reference/`.

## Design

### Module layout

All new, strict TypeScript, ES2022, BigInt allowed, no packages. `src/net/` has no Babylon, takes injected clocks and has one DOM file:
- `codec/`: packetReader, packetWriter and netErrors (PacketUnderflowError, TrailingBytesError, FramingError, ChecksumError, ProtocolError, TimeoutError, each with connection, opcode and offset), kept apart from `src/shared/typedPayload.ts` on purpose.
- `framing/frameCodec.ts`, `crypto/` (blowfish, blowfishTables, loginStream, loginRsa, gameStream), `login/` (loginPackets, loginSession) and `game/` (opcodes, `server/<Name>.ts`, `client/<Name>.ts`, packetRegistry, gameSession).
- `channel/`: packetChannel (send, onPacket, onClose, close), loginWireChannel, gameWireChannel, replayChannel.
- `transport/`: netTransport (`open(route)` gives NetConnection {send, onBytes, onClose, close}; `NetClock {nowMs}`) and webSocketTransport, the only WebSocket user.
- `capture/`: captureFormat, captureTap.

`src/world/mobius/` holds MobiusAccountSession, MobiusWorldAdapter, commandMapping and `handlers/<Name>.ts`. `tools/net-relay/src/` holds webSocketServer, relay, wireCapture, tcpTee, loginObserver and deriveFixtures. `tests/unit/net/support/mobiusTestServer.ts` is a test-only server written from this file.

### Layers and sessions

Each connection stacks bytes (NetConnection), frames (FrameDecoder) and plain packets (PacketChannel). The ciphers are passive per-direction state keyed from the decoded Init or KeyPacket, so the observer and deriver reuse them. The replay channel implements PacketChannel, so live and replay share everything above it.

LoginSession states: Connected, AuthedGG, AuthedLogin, Done, Failed. GameSession states: Connected, Keyed, Authed, Selected, Entering, InWorld (first UserInfo), Failed. Each step has a NetClock timeout, 10 s by default. `src/runtime` builds NetClock as its own monotonic clock, separate from the presentation clock. Failures are typed {stage, code, reason} with Mobius reason codes. The password lives only inside submitCredentials. A second KeyPacket, an out-of-state opcode or a closed socket ends in Failed. Character creation is outside NET-03.

### Account session

GameWorldAdapter has no surface for credentials, server lists or characters, and WorldCommand would put passwords through dispatch. A pre-world `AccountSession` (`src/world/AccountSession.ts`) offers getState, subscribe, submitCredentials(account, password), selectServer(id), selectCharacter(slot), world() (null until InWorld) and dispose. States carry server entries (id, advertised address, players, up, type bits) and character slots (name, class, level). `src/runtime` builds it for the `src/ui` login, server and character windows (data-ui lane), which import only `src/world` types. At the first UserInfo it yields the MobiusWorldAdapter, with `local-player` in getInitialState and the CharSelected game time.

### Contract commit

One integration commit before any adapter code (`docs/PORT_SCOPE.md:77`). The five GameWorldAdapter methods stay frozen, and only record types grow:
1. WorldEvent `command-rejected {commandType, reason}`, emitted synchronously from dispatch. It satisfies the contract test's spawn-npc probe.
2. `AccountSession` types.
3. WorldEvent `environment {gameMinutes, environmentType}`.
4. WorldEvents `move {entityId, origin, destination, targetId?, offset?, moveType, speeds, collision {radius, height}}`, `stop {entityId, position, heading}`, `correct {entityId, position, heading}` and `teleport {entityId, position}`, with wire integers in source units.
5. `move-local` gains `origin`, joined by the intents `report-position {position, heading}` and `cannot-move {position, heading}`. All three carry float32 source units. Existing move-local callers convert through sourceFrame in the same commit, a reversible default that gives every movement intent one unit rule.
6. EntityKind `npc`, which the MOVE-01 run start and the FX-01 ribbon rule read.
7. The boundary changes and a Mobius contract-test factory that runs a synthetic replay to the first UserInfo, with unchanged assertions.

WorldEntity positions stay metres through `src/world/sourceFrame.ts`.

### MobiusWorldAdapter

An entity map keyed by objectId holds each entity's last server position in source units, heading, speeds, collision and running flag. Network callbacks only enqueue records. advance(dt) drains them in arrival order, so live and replay emit the same sequence. Only rejections fire outside advance().
- UserInfo 0x04, CharInfo 0x03 and NpcInfo 0x16 emit `spawn` for a new objectId, then full `update`s. StatusUpdate 0x0E merges in and emits a full update.
- Movement packets emit their event and store the position for later updates.
- DeleteObject 0x12 emits `despawn`.
- The first advance() emits `environment`, and the sun packets emit it again.
- Handlers compute no outcome (ARCH-01). MOVE-01 moves pawns between records (ARCH-04).
- A lost connection is a visible error, never a fallback to MockWorldAdapter (ARCH-03).

### Command mapping

| WorldCommand | Mobius action |
|---|---|
| move-local, report-position, cannot-move | as in Movement packets |
| set-locomotion | ChangeMoveType2 0x1C: `d` 1 run, 0 walk (`ChangeMoveType2.java:32`) |
| cast-skill | Action 0x04 on a new target (`Action.java:45-49`), origin truncated from the last reported position (`lineage2js/src/network/game-client.ts:245-249`), then RequestMagicSkillUse 0x2F: `d` skillId, `d` ctrl 0, `c` shift 0 (`RequestMagicSkillUse.java:41-43`); the level is ignored |
| equip-item | UseItem 0x14 with the inventory objectId from ItemList 0x1B (`UseItem.java:66-67`); rejected as inventory-not-loaded until that handler exists |
| set-animation, preview-action | rejected as presentation-owned (ARCH-04) |
| spawn, spawn-npc, despawn, teleport-local, set-health, set-paused | rejected as demo-intent |

Rejections emit `command-rejected` and show a diagnostic, as does a command for any entity other than the local player.

### Units, ids and kinds

WorldEntity positions and headings convert once in `src/world/sourceFrame.ts`: `world = (x, z, y) * 0.01`, heading 65536 per turn with 0 along source +X. Movement records and intents stay in source units. Server ms become seconds. The UserInfo objectId is `local-player`, every other object `l2:<objectId>`. CharInfo is `remote-player`. NpcInfo is `npc` when its attackable `d` is 0, else `monster` (`lineage2js/src/network/game-packets.ts:850`; confirm in `mobius/gameserver/network/serverpackets/NpcInfo.java`), and a later flip emits an update with the new kind. Server speeds replace ACIS_HUMAN_FIGHTER_SPEED on this route.

### Relay and tee

`tools/net-relay` is one ESM file bundled by the existing esbuild devDependency, so it adds no package.
- `webSocketServer.ts`: RFC 6455 on the node:http upgrade event, `Sec-WebSocket-Accept = base64(SHA-1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))`. Client frames must be masked. Only binary, continuation, ping, pong and close pass. Unmasked frames close with 1002, text with 1003.
- `relay.ts`: a JSON route config (committed example, local file by path) maps `/login` and `/game/<id>` to allowlisted host:port pairs, with one TCP socket per WebSocket, backpressure, close propagation, per-address caps and an Origin allowlist.
- `wireCapture.ts`: opt-in, append-only JSONL per connection under `artifacts/net/captures/`. A Vite dev proxy entry serves the relay on the dev origin.
- `tcpTee.ts` listens on 2106 and 7777 and forwards bytes unchanged in the same capture format. The owner plays the stock client through it, with no binary analysis. Stock Mobius binds 7777 on all interfaces (row `game-config`), so the tee runs on another host or IP, and ipconfig.xml must advertise the tee to its subnet. That non-stock edit goes into capture provenance.

### Login observer for NET-02

`loginObserver.ts` runs the passive stream decoders on both directions and never alters bytes.
- It counts LoginFail per client address after RequestAuthLogin and clears the count on LoginOk or ServerList.
- After K failures (default 5) it refuses `/login` from that address for 900 s, so the first K attempts still reach Mobius.
- It logs account-to-address at game AuthLogin, deciphering when the flag is on, because the login-side account is inside the RSA block.
- Mobius counts all relay failures against one address, so its LoginTryBeforeBan sits far above K. Wrong-password tests use an existing account, since AutoCreateAccounts creates unknown ones.

### Captures and fixtures

- A capture is one JSONL file per connection: header {format, connection, route, startedAt in Europe/Riga, provenance}, then records {seq, tMs, dir, hex}. Raw captures stay under `artifacts/net/captures/` and are never committed.
- Committed fixtures in `tests/fixtures/net/` are synthetic: test-server cipher vectors and sessions with fixed keys, packet bodies built from Mobius layouts, and the public Blowfish vectors.
- `tests/fixtures/net/captures.json` holds only hashes and indices per real capture: raw SHA-256, provenance hashes, PacketEncryption, the seq ranges each test uses, masks, and the SHA-256 of each golden event sequence.
- Capture cases read the raw file at test time like `--client` cases, from `artifacts/net/captures/` by default, and skip with a reason when it is absent. A hash mismatch writes the actual trace (`tests/support/goldenTrace.ts`) under `artifacts/net/replay/`.
- Masks: the MoveToLocation, ValidatePosition and CannotMoveAnymore coordinates, the RSA block and the EnterWorld tracert bytes.

### Constants registry

Rows use the shared shape {id, value, provenance, status, interludeEvidence, runtimeDefault}. Login, framing and crypto rows go in `docs/parts/adapter-login/EVIDENCE.md`, the rest in `docs/parts/adapter-dispatch/EVIDENCE.md`. A row starts `unconfirmed` with the Mobius value. An L2.exe capture against Mobius makes it `confirmed-interlude`, or `corrected-interlude` when it shows another value, with interludeEvidence {capture SHA-256, connection, seq}. Rows from C4 binaries get {binary SHA-256, export or VA, offset} in Phase 5. Rows with no Interlude source stay `unknown`.

### Import boundaries and test seams

- `tests/unit/importBoundaries.net.test.ts`: the src/net closure has no packages, @babylonjs, src/shared, src/world, src/ui, src/scene or src/runtime targets. A scan finds no Date.now or performance.now, and the WebSocket global only in webSocketTransport.ts. Only src/world/mobius/**, src/runtime/**, tools/net-relay/** and tests import src/net.
- The src/world block in `tests/unit/importBoundaries.test.ts` lets the closure reach src/net/** except webSocketTransport.ts, through src/world/mobius/** only. concreteAdapterModules gains MobiusWorldAdapter.ts.
- FrameDecoder and the ciphers are pure. Sessions take a PacketChannel, so tests use an in-memory pair or a replay channel. The relay is tested over node:net loopback. A registry test fails when a decoder lacks a synthetic fixture.

## No vendor dependencies

| Reference uses | For | We use |
|---|---|---|
| egoroof-blowfish, gmp-wasm | Login Blowfish and RSA modpow (`lineage2js/src/network/l2-crypt.ts:1-2,10-45,103-122`) | `src/net/crypto/blowfish.ts` and BigInt in `loginRsa.ts` |
| three, `@l2js/engine` | Positions, enums and schemas in handlers (`lineage2js/src/network/network-manager.ts:8`, `l2-replay-recorder.ts:1`) | Plain records and sourceFrame |
| pako, node-forge, uuid, chokidar, three-wasm, rapier | Declared in `lineage2js/package.json:37-48`, unused by the network | None; DecompressionStream if deflate appears |
| IndexedDB, performance.now | Replay storage, timestamps (`lineage2js/src/network/replay-files.ts:3`) | Plain capture files and NetClock |
| ws, websockify, Elbera gateway modules | WebSocket to TCP bridging; aCis crypto in Node | `tools/net-relay` on node:http, node:net and node:crypto |

## Shared modules

- `src/world/sourceFrame.ts`: WorldEntity positions and headings only.
- `src/shared/presentationClock.ts`: replays step it at a fixed `dt`; src/net never imports it.
- `src/net/channel/replayChannel.ts` and `tools/net-relay/`: built here, reused by movement replays.
- `tests/support/goldenTrace.ts` and `tests/support/staticImportGraph.ts`.
- `tools/reference-overlap/`: built here for all five areas.
- The README constants row shape, in the two adapter EVIDENCE.md files.
- The gap-reason naming pattern, for runtime diagnostics only.

## Acceptance

- Framing: frames split at every byte boundary into 2 and 3 chunks come out whole and in order, and a split header waits. `L = 2` is counted and dropped, and `L` below 2 raises FramingError. encodeFrame rejects 65534 bytes. A throw on frame 1 still dispatches frames 2 and 3.
- Codec: every type round-trips at its range edges, and underflow reports opcode, offset, need and length. The writer throws for c 256, h 65536, d 2^32, q 2^64, NaN and S with U+0000. Undeclared game leftover and one nonzero login padding byte fail.
- Blowfish: published ECB vectors pass through a big-endian test adapter, random buffers round-trip, the tables match a fresh BigInt pi, and a key with 0x00 bytes schedules at full length.
- Login: test-server frames open exactly, and `P = 170` gives `N = 192`. rsaRawEncrypt matches Python `pow(m, 65537, n)`. With a local capture, Init opens to 0xC621, a modulus with top and low bits set, a 16-byte key and zero padding, and every later frame passes the checksum. On sandbox Mobius, AuthGameGuard returns GGAuth with our sessionId.
- Game stream: 100 synthetic packets round-trip with the counter checked after each, and a second KeyPacket raises ProtocolError. Local captures under both PacketEncryption settings decode to known opcodes only.
- Movement: synthetic movement packets give their events with the wire integers. Builders round or truncate correctly at 10.5, -10.5, -0.5 and the float32 neighbours of 10.5, and move-local sends its given origin.
- Time and kinds: CharSelected game time 750 gives `environment {gameMinutes: 750, environmentType: 0}` on the first advance(). SunRise gives 420 and SunSet 60. NpcInfo attackable 0 spawns `npc`, 1 spawns `monster`.
- NET-03 sandbox: through the relay the browser logs in to stock Mobius with a throwaway account, lists servers, gets PlayOk, selects a character and reaches UserInfo. A wrong password shows its reason, a silent server shows a timeout, and the run logs its time in Europe/Riga.
- Replay: every registered decoder has a synthetic fixture. A synthetic 'login, enter world, walk, attack, logout' session matches its golden trace at a fixed `dt`. With local captures, packets decode with zero leftover, the event hash matches captures.json, and client packets match outside the masks.
- Contract and boundaries: the contract test passes unchanged for the Mobius factory, and both boundary tests pass.
- Relay: the RFC 6455 sample key `dGhlIHNhbXBsZSBub25jZQ==` yields `s3pPLMBiTxaQ9kYGzzhZRbK+xOo=`. Fragmented messages reassemble. Unmasked frames close with 1002, text with 1003, and unlisted routes are refused. K failures block one address for 900 s while another logs in, a success clears the count, and AuthLogin logs account-to-address.
- Overlap: `tools/reference-overlap/` over src/net/**, src/world/mobius/** and tools/net-relay/** against `lineage2js/src/network/**`, `l2js-core/src/crypto/**`, the Mobius crypt and network folders and `elbera-gateway/src/**` passes the README thresholds with the constant allowlist, and a reviewer who did not write the code signs off in the part's EVIDENCE.md.
- Phase 4 parity: L2.exe through the tee and our client through the relay walk one step on one Mobius. Client packets match field for field outside the masks, report rounding included. Every captured server packet decodes or is counted as unhandled in `docs/parts/adapter-dispatch/EVIDENCE.md`.

## Implementation steps

1. Pins and overlap checker. Requirement: NET-09 (proposed). Output: Reference pins, Mobius and Elbera where the roadmap owner pins them, and `tools/reference-overlap/` with globs, allowlist and a pin lock check. `.git/info/exclude` covers the pins until the native-world-slice cleanup adds ignore rules. Check: Pins print clean, and a planted 20-token copy is flagged.
2. Contract commit. Requirement: ARCH-02, NET-04. Output: The seven changes in Design. Check: Every lane's typecheck and unit tests stay green.
3. Codec, framing, ciphers, relay and tee. Requirement: NET-01, NET-03, NET-09 (proposed), NET-10 (proposed). Output: `src/net/codec`, `framing`, `crypto`, the test server and `tools/net-relay` without the observer. Check: Synthetic and relay acceptance.
4. Capture campaign (manual). Requirement: NET-04, NET-10 (proposed). Output: L2.exe through the tee under both PacketEncryption settings. Check: Confirmed rows carry capture hashes.
5. Deriver, sessions and registry. Requirement: NET-03, NET-04. Output: deriveFixtures, captures.json, both sessions, full opcodes.ts, the Game entry packets plus RequestNetPing, NetPing and LeaveWorld 0x7E, the replay channel and the tap. Check: A sandbox login reaches CharSelected.
6. Adapter and handlers. Requirement: NET-03, NET-04, ARCH-01 to ARCH-04, MOVE-02 (proposed), MAT-02 (proposed). Output: MobiusAccountSession, MobiusWorldAdapter, commandMapping, entity, movement and time handlers, and runtime selection behind an explicit setting. Check: Sandbox, movement, time, replay, contract and boundary acceptance, with MOVE-01 consuming the events.
7. Login observer. Requirement: NET-02. Output: `loginObserver.ts` and the documented ban config. Check: Relay ban acceptance.
8. Packet by packet. Requirement: NET-04 to NET-07. Output: Per packet: Mobius class, capture, decoder, synthetic fixture, handler. AttackRequest 0x0A, Attack, MagicSkillUse and StatusUpdate feed NET-05; NpcHtmlMessage, BuyList, SellList and MultiSellList NET-06; party, clan, chat and quest NET-07. Check: Coverage and overlap stay green.
9. Parity run, then the deferred .l2r importer. Requirement: NET-10 (proposed). Output: L2.exe and our client on one Mobius build. The importer waits for an owner-recorded Interlude replay and the Phase 5 (POL-04) re-derivation. Check: Phase 4 parity acceptance.

## Open questions

- Which ProtocolVersion does L2.exe send: 746, 744, 740 or 737?
- Does L2.exe obey the KeyPacket flag, and should the sandbox run PacketEncryption on?
- Which host runs the tee, and how does L2.exe reach it without touching the read-only reference install?
- Which LoginTryBeforeBan sits above the relay limit, and should AutoCreateAccounts stay on?
- Does Mobius drop clients that never ping, and how often does L2.exe ping?
- Does the banned-address LoginFail reach the wire before Init?
- Does L2.exe's RequestAuthLogin carry bytes after the RSA block?
- Which packet carries the environment type? This file owns the question.
- Is the NpcInfo attackable field per viewer, so a guard reads as `monster` to a chaotic player?
- How do LoginFail and PlayFail codes map to Interlude systemmsg ids?
- Should account names be limited to [A-Za-z0-9]?
- Does the Interlude interface need .l2r replay support?
