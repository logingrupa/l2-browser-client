import { confirmedInterludeConstantRow } from "../../../shared/referenceConstant";

const rebuildReport = "DB-16 bsp-lightmap-cache-rebuild.json 599d44b8, listings bsp-lightmap-cache-db16/rebuild, spec 06-critic spot checks; DB-17 ordinary-lightmap-rebuild-helpers.json fb15ebf4 pseudocode and native fixtures under ordinary-lightmap-db17/numeric";
const replayedConstant = (virtualAddress: string, byteOffset: number, bytesHex: string) =>
  `${rebuildReport}; Engine.dll 4dd2f63c constant ${virtualAddress} (file offset ${byteOffset}, bytes ${bytesHex}, rebuild.constantData)`;
const listingEvidence = (evidence: string) => `${rebuildReport}; Engine.dll 4dd2f63c ${evidence}`;
const precisionNote = "x87 runs at 53-bit precision (DB-17 replays the whole constructor under control word 0x027f), so float64 arithmetic with Math.fround at each fstp dword matches; the generated attenuation, shadow pattern and power -0.5 tables hash equal to their ranges of lighting-tables-cw027f.bin";

export const LIGHTMAP_REBUILD_CONSTANTS = {
  attenuationTableSize: confirmedInterludeConstantRow("lightmap-rebuild.attenuation-table-size", 4096,
    listingEvidence("table builder 0x10670de0 loops cmp esi, 0x1000 at 0x10670e12 and writes one float32 per entry at 0x10670e61")),
  attenuationSampleStep: confirmedInterludeConstantRow("lightmap-rebuild.attenuation-sample-step", 0.000244140625,
    `${replayedConstant("0x108dd8f8", 6147320, "000000000000303f")}; 0x10670e23 multiplies float(i + 1) by it before appSqrt; ${precisionNote}`),
  attenuationCubicCoefficient: confirmedInterludeConstantRow("lightmap-rebuild.attenuation-cubic-coefficient", 3,
    `${replayedConstant("0x10853b28", 5582632, "0000000000000840")}; 0x10670e48 fmul in ((2f)f)f - (3f)f + 1`),
  attenuationCubicConstant: confirmedInterludeConstantRow("lightmap-rebuild.attenuation-cubic-constant", 1,
    `${replayedConstant("0x10852238", 5576248, "000000000000f03f")}; 0x10670e52 fadd before the float32 store and the divide by f`),
  shadowKernelRows: confirmedInterludeConstantRow("lightmap-rebuild.shadow-kernel-rows", { edgeRow: [0, 24, 40, 24], centreRow: [0, 40, 64, 40] } as const,
    listingEvidence("0x10670f0f-0x10670fad writes the 8 x 8 kernel with immediates 0x18, 0x28 and 0x40 into rows 0, 1 and 2, columns 1 to 3; rows 3 to 7 are zero; 0x10671070-0x1067109e sums it to 320")),
  shadowPatternCount: confirmedInterludeConstantRow("lightmap-rebuild.shadow-pattern-count", 128,
    listingEvidence("0x106710a5 cmp ebx, 0x80 over 4 rows (0x106710b6) of 4 byte lanes (0x106710cf), each lane idiv(sum * 0xff, total) shifted by 8 * lane")),
  inverseSquareRootPower: confirmedInterludeConstantRow("lightmap-rebuild.inverse-square-root-power", -0.5,
    `${replayedConstant("0x108a7a10", 5926416, "000000bf")} float32; 0x10670ed7 passes it to the power table builder 0x10670c80 for the mantissa table 0x10db40f8 and exponent table 0x10db28f8 read by 0x10670250`),
  inverseSquareRootTableSizes: confirmedInterludeConstantRow("lightmap-rebuild.inverse-square-root-table-sizes", { mantissaEntries: 1024, exponentEntries: 512 } as const,
    listingEvidence("0x10670c80 exponent loop cmp esi, 0x200 at 0x10670d06 and mantissa loop add esi, 0x2000 up to 0x800000 at 0x10670d84; lookup 0x10670250 and eax, 0x3ff and shr ebx, 0x17")),
  falloffIndexScale: confirmedInterludeConstantRow("lightmap-rebuild.falloff-index-scale", 4093,
    `${replayedConstant("0x108ddbd8", 6148056, "0000000000faaf40")}; 0x10671af4 idxScale = float32((4093 * invR) * invR)`),
  pointFalloffFixedPointScale: confirmedInterludeConstantRow("lightmap-rebuild.point-falloff-fixed-point-scale", 4096,
    `${replayedConstant("0x108dda28", 6147624, "000000000000b040")}; 0x1067351d scale = float32(idxScale * 4096)`),
  floatRoundingBias: confirmedInterludeConstantRow("lightmap-rebuild.float-rounding-bias", 8388608,
    `${replayedConstant("0x108dda18", 6147608, "0000000000006041")}; 0x1067373b, the effect 0 texel stores float32(value + 2^23) and keeps its low byte at 0x106737a4`),
  forwardDifferenceFactor: confirmedInterludeConstantRow("lightmap-rebuild.forward-difference-factor", 2,
    listingEvidence("constant 0x1085b788 (file offset 5614472, bytes 0000000000000040, DB-17 claim NUM-point-recurrence replay); the DB-17 0x10671890 pseudocode loads it at 0x106736d9 for the effect 0 recurrence rowDelta = 2c + dv, rowDelta2 = 2dv, xDelta = 2b + du, xyDelta = 2uv and xDelta2 = 2du stored at 0x106736d1-0x10673730; the effect 0 attenuation native fixtures exercise it")),
  texelCentreOffset: confirmedInterludeConstantRow("lightmap-rebuild.texel-centre-offset", 0.5,
    listingEvidence("double 0.5 at 0x10859038 (file offset 5604408, bytes 000000000000e03f, DB-7 hourly-lighting-composition replay) added at 0x10671b66 and 0x10671b9e to minY and minX")),
  coneByteScale: confirmedInterludeConstantRow("lightmap-rebuild.cone-byte-scale", 0.00390625,
    `${replayedConstant("0x108b3060", 5973088, "000000000000703f")}; 0x10673896 s = float32(1 - LightCone * this)`),
  colourTableChannelScale: confirmedInterludeConstantRow("lightmap-rebuild.colour-table-channel-scale", 256,
    `${replayedConstant("0x108ba308", 6002440, "0000000000007040")}; 0x10671313, 0x10671344 and 0x10671372 multiply each colour channel before the chop fistp qword`),
  colourTableEntries: confirmedInterludeConstantRow("lightmap-rebuild.colour-table-entries", 256,
    listingEvidence("0x106712ef pushes 0x100 FColor entries; 0x10671423 cmp esi, 0x100; 0x10671492 writes alpha 0xff; 0x1067133d shift = uint8(0x20 - appCeilLogTwo), DB-17 appCeilLogTwo 0x1014f800 returns AL = 0 for 0 and bit_length(n - 1) otherwise")),
  falloffIndexLimit: confirmedInterludeConstantRow("lightmap-rebuild.falloff-index-limit", 0x1000,
    listingEvidence("effects 8 and 12 compare the appRound index unsigned with cmp ebx, 0x1000 at 0x10673918")),
  pointFalloffAccumulatorLimit: confirmedInterludeConstantRow("lightmap-rebuild.point-falloff-accumulator-limit", 0x1000000,
    listingEvidence("effect 0 compares the accumulator unsigned with cmp ecx, 0x1000000 at 0x10673779 and indexes the attenuation table with shr eax, 0xc at 0x10673783")),
  twoSidedPolyFlag: confirmedInterludeConstantRow("lightmap-rebuild.two-sided-poly-flag", 0x100,
    listingEvidence("effect 19 tests FBspSurf PolyFlags with test dword ptr [eax + 4], 0x100 at 0x106719eb and takes Abs (0x10370480) instead of Max(0, dot) (0x104a4940)")),
  lightEffectBranches: confirmedInterludeConstantRow("lightmap-rebuild.light-effect-branches", {
    sunDirection: 0x13, spotCone: [0x08, 0x0c], unported: [0x04, 0x12, 0x05, 0x06, 0x09, 0x0a, 0x11, 0x10, 0x0d, 0x14, 0x0e],
  } as const, listingEvidence("0x10671890 compares LightEffect byte actor+0x3bd with 0x13 at 0x106719a0, then 4, 0x12, 5, 6, 9, 0xa, 0x11, 0x10 at 0x10671c48-0x10672d0b, 0xc and 8 at 0x10672f45 (both to 0x10673862), 0xd, 0x14 and 0xe; every other id reaches the effect 0 code at 0x106734b5")),
  maskBitsPerByte: confirmedInterludeConstantRow("lightmap-rebuild.mask-bits-per-byte", 8,
    listingEvidence("0x10671642 and 0x106718fe triple add eax, eax: the filtered row stride is RowBytes (+0x30) * 8")),
} as const;
