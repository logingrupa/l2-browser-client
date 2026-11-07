import { Engine } from "@babylonjs/core/Engines/engine";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { RenderTargetWrapper } from "@babylonjs/core/Engines/renderTargetWrapper";
import { EffectRenderer, EffectWrapper } from "@babylonjs/core/Materials/effectRenderer";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color4 } from "@babylonjs/core/Maths/math.color";

/** Test-only, explicitly conditional legacy method-2 reference. This does not
 * select a native route, load production assets, or replace Editor materials. */
export interface TerrainLegacyTexture {
  width: number;
  height: number;
  rgba: readonly number[] | Uint8Array;
  filter: "nearest" | "bilinear";
  address: "clamp" | "repeat";
  precision: "rgba8" | "rgba4-high-nibble";
  /** Affine UV rows applied to normalized output pixel coordinates. No inferred
   * native phase: even constant sampling must be supplied explicitly. */
  uvRows: readonly [readonly [number, number, number], readonly [number, number, number]];
}

export interface TerrainLegacyPass {
  id: string;
  isTransparent: boolean;
  diffuse: TerrainLegacyTexture;
  mask: TerrainLegacyTexture;
}

export interface TerrainLegacyFixture {
  id: string;
  width: number;
  height: number;
  clearRgba: readonly [number, number, number, number];
  alphaAssumption: "shared-factors" | "separate-source-over";
  /** Already retained, already ordered. No pruning/classification happens here. */
  passes: readonly TerrainLegacyPass[];
}

export interface TerrainLegacyTextureReceipt {
  width: number;
  height: number;
  filter: TerrainLegacyTexture["filter"];
  address: TerrainLegacyTexture["address"];
  precision: TerrainLegacyTexture["precision"];
  uvRows: TerrainLegacyTexture["uvRows"];
  sourceBytes: number;
  uploadedBytes: number;
  uploadType: number;
  componentBits: number[];
  mipLevels: 1;
  srgb: false;
  premultiplied: false;
  invertY: false;
}

export interface TerrainLegacyStateReceipt {
  blendEnabled: boolean;
  srcRgb: number;
  dstRgb: number;
  srcAlpha: number;
  dstAlpha: number;
  equationRgb: number;
  equationAlpha: number;
  depthTest: boolean;
  stencilTest: boolean;
  dither: boolean;
}

export interface TerrainLegacyReceipt {
  id: string;
  width: number;
  height: number;
  /** RGBA8 readback, bottom row first (WebGL convention). */
  pixels: number[];
  perPass: {
    id: string;
    firstPass: boolean;
    isTransparent: boolean;
    pixels: number[];
    state: TerrainLegacyStateReceipt;
    diffuse: TerrainLegacyTextureReceipt;
    mask: TerrainLegacyTextureReceipt;
  }[];
  alphaAssumption: TerrainLegacyFixture["alphaAssumption"];
  target: { format: "RGBA8"; componentBits: number[]; samples: 1 };
  engine: { version: string; webGLVersion: number; vendor: string; renderer: string; versionString: string };
  resources: { texturesBefore: number; texturesAfter: number; targetDisposed: true };
  limitations: string[];
}

function dimension(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}
const byte = (value: number) => Number.isInteger(value) && value >= 0 && value <= 255;

function validateTexture(texture: TerrainLegacyTexture): void {
  if (!texture || !dimension(texture.width, 1024) || !dimension(texture.height, 1024) ||
    !(Array.isArray(texture.rgba) || texture.rgba instanceof Uint8Array) ||
    texture.rgba.length !== texture.width * texture.height * 4 || !texture.rgba.every(byte)) {
    throw new Error("Reference texture requires bounded dimensions and exact RGBA byte data.");
  }
  if (!["nearest", "bilinear"].includes(texture.filter) || !["clamp", "repeat"].includes(texture.address) ||
    !["rgba8", "rgba4-high-nibble"].includes(texture.precision) || !Array.isArray(texture.uvRows) ||
    texture.uvRows.length !== 2 || texture.uvRows.some(row => !Array.isArray(row) || row.length !== 3 || !row.every(Number.isFinite))) {
    throw new Error("Reference texture requires explicit supported sampler, precision and UV rows.");
  }
}

export function validateTerrainLegacyFixture(fixture: TerrainLegacyFixture): void {
  if (!fixture || typeof fixture.id !== "string" || !fixture.id.trim() || !dimension(fixture.width, 256) || !dimension(fixture.height, 256) ||
    !Array.isArray(fixture.clearRgba) || fixture.clearRgba.length !== 4 || !fixture.clearRgba.every(byte) ||
    !["shared-factors", "separate-source-over"].includes(fixture.alphaAssumption) ||
    !Array.isArray(fixture.passes) || fixture.passes.length < 1 || fixture.passes.length > 16) {
    throw new Error("Reference fixture requires explicit bounded target, clear, alpha assumption and retained passes.");
  }
  const ids = new Set<string>();
  let bytes = 0;
  for (const pass of fixture.passes) {
    if (!pass || typeof pass.id !== "string" || !pass.id.trim() || ids.has(pass.id) || typeof pass.isTransparent !== "boolean") {
      throw new Error("Reference pass requires a unique retained identity and explicit IsTransparent predicate.");
    }
    ids.add(pass.id);
    for (const texture of [pass.diffuse, pass.mask]) { validateTexture(texture); bytes += texture.rgba.length; }
  }
  if (bytes > 32 * 1024 * 1024) throw new Error("Reference fixture input exceeds 32 MiB.");
}

/** A4R4G4B4's proved high-nibble channel reduction, repacked into WebGL's
 * RGBA4444 word ordering. This does not reinterpret native BC1 or P8 bytes. */
export function prepareTerrainReferenceTexture(texture: TerrainLegacyTexture): Uint8Array | Uint16Array {
  validateTexture(texture);
  if (texture.precision === "rgba8") return new Uint8Array(texture.rgba);
  const words = new Uint16Array(texture.width * texture.height);
  for (let pixel = 0; pixel < words.length; pixel++) {
    const at = pixel * 4;
    words[pixel] = ((texture.rgba[at]! >>> 4) << 12) | ((texture.rgba[at + 1]! >>> 4) << 8) |
      ((texture.rgba[at + 2]! >>> 4) << 4) | (texture.rgba[at + 3]! >>> 4);
  }
  return words;
}

const vertexShader = `precision highp float;
attribute vec2 position;
varying vec2 fixtureUV;
void main() { fixtureUV=position*0.5+0.5; gl_Position=vec4(position,0.0,1.0); }`;
const fragmentShader = `precision highp float;
varying vec2 fixtureUV;
uniform sampler2D diffuseSampler;
uniform sampler2D maskSampler;
uniform vec3 diffuseU; uniform vec3 diffuseV;
uniform vec3 maskU; uniform vec3 maskV;
uniform float transparentDiffuse; uniform float firstPass;
void main() {
  vec3 p=vec3(fixtureUV,1.0);
  vec4 diffuse=texture2D(diffuseSampler,vec2(dot(diffuseU,p),dot(diffuseV,p)));
  float alpha=texture2D(maskSampler,vec2(dot(maskU,p),dot(maskV,p))).a;
  if(transparentDiffuse>0.5) alpha*=diffuse.a;
  if(firstPass<0.5 && alpha<=0.0) discard;
  gl_FragColor=vec4(diffuse.rgb,alpha);
}`;

/** Owns a dedicated engine. Use a dedicated canvas, never the game canvas.
 * Each render performs real ordered RGBA8 framebuffer writes and reads each
 * pass. Readback makes this an arithmetic fixture, NOT a performance benchmark. */
export function createTerrainLegacyReferenceRenderer(canvas: HTMLCanvasElement): {
  render(fixture: TerrainLegacyFixture): Promise<TerrainLegacyReceipt>;
  dispose(): void;
} {
  const engine = new Engine(canvas, false, { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, stencil: false });
  const context = canvas.getContext("webgl2");
  if (!context || engine.webGLVersion !== 2) { engine.dispose(); throw new Error("Ordered terrain reference requires actual WebGL2."); }
  const gl: WebGL2RenderingContext = context;
  const renderer = new EffectRenderer(engine);
  const wrapper = new EffectWrapper({ engine, name: "Conditional legacy terrain reference", vertexShader, fragmentShader,
    attributeNames: ["position"], uniformNames: ["diffuseU", "diffuseV", "maskU", "maskV", "transparentDiffuse", "firstPass"],
    samplerNames: ["diffuseSampler", "maskSampler"] });
  let disposed = false, busy = false;
  const alive = () => {
    if (disposed || engine.isDisposed || gl.isContextLost()) throw new Error("Ordered terrain reference disposed or context lost.");
  };
  const finishDispose = () => { wrapper.dispose(); renderer.dispose(); engine.dispose(); };
  const componentBits = () => [gl.FRAMEBUFFER_ATTACHMENT_RED_SIZE, gl.FRAMEBUFFER_ATTACHMENT_GREEN_SIZE,
    gl.FRAMEBUFFER_ATTACHMENT_BLUE_SIZE, gl.FRAMEBUFFER_ATTACHMENT_ALPHA_SIZE].map(parameter =>
    Number(gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, parameter)));
  const assertGl = (stage: string) => { const error = gl.getError(); if (error !== gl.NO_ERROR) throw new Error(`${stage}: WebGL error ${error}.`); };

  async function ready(): Promise<void> {
    const deadline = performance.now() + 10_000;
    while (!wrapper.isReady()) {
      alive();
      const error = wrapper.effect.getCompilationError();
      if (error) throw new Error(`Reference shader compilation failed: ${error}`);
      if (performance.now() >= deadline) throw new Error("Reference shader compilation timed out.");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  function upload(spec: TerrainLegacyTexture, textures: RawTexture[]): { texture: RawTexture; receipt: TerrainLegacyTextureReceipt } {
    const data = prepareTerrainReferenceTexture(spec), rgba4 = spec.precision === "rgba4-high-nibble";
    const texture = RawTexture.CreateRGBATexture(data, spec.width, spec.height, engine, false, false,
      spec.filter === "nearest" ? Texture.NEAREST_SAMPLINGMODE : Texture.BILINEAR_SAMPLINGMODE,
      rgba4 ? Constants.TEXTURETYPE_UNSIGNED_SHORT_4_4_4_4 : Constants.TEXTURETYPE_UNSIGNED_BYTE, 0, false);
    textures.push(texture);
    texture.gammaSpace = false;
    texture.wrapU = texture.wrapV = spec.address === "repeat" ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 1;
    assertGl("Texture upload");
    // Query the uploaded texture's actual component precision through a
    // temporary attachment; WebGL has no getTexLevelParameter equivalent.
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error("Cannot allocate texture precision inspection framebuffer.");
    const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    let bits: number[];
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D,
        texture.getInternalTexture()?._hardwareTexture?.underlyingResource as WebGLTexture | null, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Uploaded reference format is not framebuffer complete.");
      bits = componentBits();
      if (bits.some(value => value !== (rgba4 ? 4 : 8))) throw new Error(`Uploaded reference precision differs: ${bits.join("/")}.`);
      assertGl("Texture precision query");
    } finally { gl.bindFramebuffer(gl.FRAMEBUFFER, previous); gl.deleteFramebuffer(framebuffer); }
    return { texture, receipt: { width: spec.width, height: spec.height, filter: spec.filter, address: spec.address,
      precision: spec.precision, uvRows: spec.uvRows, sourceBytes: spec.rgba.length, uploadedBytes: data.byteLength,
      uploadType: rgba4 ? gl.UNSIGNED_SHORT_4_4_4_4 : gl.UNSIGNED_BYTE, componentBits: bits,
      mipLevels: 1, srgb: false, premultiplied: false, invertY: false } };
  }

  async function render(fixture: TerrainLegacyFixture): Promise<TerrainLegacyReceipt> {
    alive(); validateTerrainLegacyFixture(fixture);
    if (busy) throw new Error("Reference renderer already has an active fixture.");
    busy = true;
    const texturesBefore = engine.getLoadedTexturesCache().length, textures: RawTexture[] = [];
    let target: RenderTargetWrapper | undefined;
    let receipt: Omit<TerrainLegacyReceipt, "resources">;
    try {
      await ready(); alive();
      const inputs = fixture.passes.map(pass => ({ pass, diffuse: upload(pass.diffuse, textures), mask: upload(pass.mask, textures) }));
      target = engine.createRenderTargetTexture({ width: fixture.width, height: fixture.height }, {
        type: Constants.TEXTURETYPE_UNSIGNED_BYTE, format: Constants.TEXTUREFORMAT_RGBA, samplingMode: Texture.NEAREST_SAMPLINGMODE,
        generateMipMaps: false, generateDepthBuffer: false, generateStencilBuffer: false, samples: 1, useSRGBBuffer: false });
      engine.bindFramebuffer(target);
      renderer.setViewport();
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Reference target is not framebuffer complete.");
      const targetBits = componentBits();
      if (targetBits.some(value => value !== 8)) throw new Error(`Reference target is not RGBA8: ${targetBits.join("/")}.`);
      gl.disable(gl.DITHER); gl.disable(gl.SCISSOR_TEST);
      engine.setColorWrite(true);
      engine.clear(new Color4(...fixture.clearRgba.map(value => value / 255) as [number, number, number, number]), true, false, false);
      const perPass: TerrainLegacyReceipt["perPass"] = [];
      for (const [index, input] of inputs.entries()) {
        alive();
        renderer.applyEffectWrapper(wrapper, false, false);
        const effect = wrapper.effect;
        for (const [prefix, prepared, spec] of [["diffuse", input.diffuse, input.pass.diffuse], ["mask", input.mask, input.pass.mask]] as const) {
          effect.setTexture(`${prefix}Sampler`, prepared.texture);
          effect.setFloat3(`${prefix}U`, ...spec.uvRows[0]); effect.setFloat3(`${prefix}V`, ...spec.uvRows[1]);
        }
        effect.setFloat("transparentDiffuse", input.pass.isTransparent ? 1 : 0);
        effect.setFloat("firstPass", index === 0 ? 1 : 0);
        engine.setState(false);
        engine.setDepthWrite(false);
        // Babylon ALPHA_COMBINE selects ONE for source alpha. Supply all four
        // factors and both equations explicitly instead of inheriting it.
        engine.alphaState.alphaBlend = index !== 0;
        engine.alphaState.setAlphaBlendFunctionParameters(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
          fixture.alphaAssumption === "shared-factors" ? gl.SRC_ALPHA : gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        engine.alphaState.setAlphaEquationParameters(gl.FUNC_ADD, gl.FUNC_ADD);
        engine.applyStates();
        renderer.draw();
        assertGl(`Retained pass ${input.pass.id}`);
        const state: TerrainLegacyStateReceipt = {
          blendEnabled: gl.isEnabled(gl.BLEND), srcRgb: Number(gl.getParameter(gl.BLEND_SRC_RGB)), dstRgb: Number(gl.getParameter(gl.BLEND_DST_RGB)),
          srcAlpha: Number(gl.getParameter(gl.BLEND_SRC_ALPHA)), dstAlpha: Number(gl.getParameter(gl.BLEND_DST_ALPHA)),
          equationRgb: Number(gl.getParameter(gl.BLEND_EQUATION_RGB)), equationAlpha: Number(gl.getParameter(gl.BLEND_EQUATION_ALPHA)),
          depthTest: gl.isEnabled(gl.DEPTH_TEST), stencilTest: gl.isEnabled(gl.STENCIL_TEST), dither: gl.isEnabled(gl.DITHER),
        };
        const readback = await engine.readPixels(0, 0, fixture.width, fixture.height, true, true);
        alive(); assertGl(`Readback ${input.pass.id}`);
        const pixels = Array.from(new Uint8Array(readback.buffer, readback.byteOffset, readback.byteLength));
        if (pixels.length !== fixture.width * fixture.height * 4) throw new Error("Reference readback dimensions differ.");
        perPass.push({ id: input.pass.id, firstPass: index === 0, isTransparent: input.pass.isTransparent, pixels, state,
          diffuse: input.diffuse.receipt, mask: input.mask.receipt });
      }
      const info = engine.getGlInfo();
      receipt = { id: fixture.id, width: fixture.width, height: fixture.height, pixels: perPass.at(-1)!.pixels, perPass,
        alphaAssumption: fixture.alphaAssumption, target: { format: "RGBA8", componentBits: targetBits, samples: 1 },
        engine: { version: Engine.Version, webGLVersion: engine.webGLVersion, vendor: info.vendor, renderer: info.renderer, versionString: info.version },
        limitations: ["Conditional legacy method-2 bitmap experiment; active native route and draw state are unverified.",
          "ADD, RGBA8 framebuffer, no depth/fog/lighting and the selected alpha model are explicit fixture assumptions.",
          "Supplied normalized UV rows and mip0 sampling do not establish native mask phase, mip upload or sampler state.",
          "RGBA4 is conditional high-nibble reduction before actual RGBA4 upload; ordinary BC1 and CPU classification are untouched.",
          "Per-pass readback is diagnostic overhead; this is not native parity or a performance measurement."] };
    } finally {
      if (target) { engine.unBindFramebuffer(target, true); target.dispose(); }
      textures.forEach(texture => texture.dispose());
      busy = false;
      if (disposed) finishDispose();
    }
    return { ...receipt, resources: { texturesBefore, texturesAfter: engine.getLoadedTexturesCache().length, targetDisposed: true } };
  }
  return { render, dispose() { if (disposed) return; disposed = true; if (!busy) finishDispose(); } };
}
