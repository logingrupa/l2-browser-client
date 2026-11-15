"use strict";

const title = "WebGPU compiler and UV2 export compatibility";
const description = "Repairs Editor 5.5.3 compiler preparation and preserves Babylon 9.27.1 UV2 during Save and Play.";
const { installGeometryCompatibility } = require("./geometry.cjs");
let active;

/** Editor loads plugins after dependency installation, concurrently with scene
 * loading. Existing GLSL effects may already be waiting on the known rejected
 * preparation promise. Keep their objects/callbacks and retry those effects;
 * marking a ShaderMaterial dirty alone reuses its unchanged failed effect.
 * Private members below are deliberately limited to the pinned 9.27.1 engine. */
function installCompilerCompatibility(WebGPUEngine, engines, timeoutMs = 30_000) {
  if (WebGPUEngine.Version !== "9.27.1") throw new Error(`${title} requires Babylon 9.27.1; review this workaround before upgrading.`);
  const prototype = WebGPUEngine.prototype;
  const original = prototype._initGlslangAsync;
  if (typeof original !== "function") throw new Error("The expected Babylon GLSL initializer is missing.");
  const wrapped = function (...args) { return Promise.resolve(original.apply(this, args)); };
  prototype._initGlslangAsync = wrapped;
  let closed = false;
  const cancelWaits = new Set();

  function bounded(promise, label) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${title}: ${label} timed out.`)), timeoutMs);
    })]).finally(() => clearTimeout(timer));
  }

  function retryEffect(effect) {
    return new Promise((resolve, reject) => {
      let compiled, failed, timer;
      const finish = error => {
        clearTimeout(timer);
        effect.onCompileObservable.remove(compiled);
        effect.onErrorObservable.remove(failed);
        cancelWaits.delete(cancel);
        error ? reject(error) : resolve();
      };
      const cancel = () => finish();
      cancelWaits.add(cancel);
      compiled = effect.onCompileObservable.addOnce(() => finish());
      failed = effect.onErrorObservable.addOnce(() => finish(new Error(`GLSL retry failed: ${effect.getCompilationError()}`)));
      timer = setTimeout(() => finish(new Error("GLSL effect retry timed out.")), timeoutMs);
      try { effect._prepareEffect(); } catch (error) { finish(error); }
    });
  }

  async function repair(engine) {
    if (!engine.isWebGPU || engine._isDisposed || engine._glslangAndTintAreFullyLoaded) return 0;
    const options = engine._glslangOptions ?? engine.getCreationOptions().glslangOptions;
    const compiler = options?.glslang;
    const isRawCompiler = compiler && typeof compiler.then !== "function" && typeof compiler.compileGLSL === "function";
    const previous = engine._workingGlslangAndTintPromise;
    let retry = [];
    if (previous) {
      try { await bounded(previous, "existing compiler preparation"); }
      catch (error) {
        // Do not erase a download, shader or unrelated preparation failure.
        if (!isRawCompiler || error?.name !== "TypeError" || !/_initGlslangAsync.*\.then is not a function/.test(error.message)) throw error;
        if (closed || engine._isDisposed) return 0;
        if (engine._workingGlslangAndTintPromise !== previous) throw new Error("Compiler preparation changed during compatibility repair.");
        engine._workingGlslangAndTintPromise = null;
        retry = Object.values(engine._compiledEffects ?? {}).filter(effect =>
          !effect.isDisposed && effect._shaderLanguage === 0 && !effect._isReady && effect._pipelineContext &&
          effect._vertexSourceCode && effect._fragmentSourceCode);
      }
    }
    if (closed || engine._isDisposed) return 0;
    await bounded(engine.prepareGlslangAndTintAsync(), "compiler preparation");
    if (closed || engine._isDisposed) return 0;
    retry = retry.filter(effect => !effect.isDisposed && !effect._isReady);
    await Promise.all(retry.map(retryEffect));
    return retry.length;
  }

  const ready = Promise.all(engines.map(repair)).then(counts => counts.reduce((sum, count) => sum + count, 0));
  return {
    ready,
    close() {
      closed = true;
      for (const cancel of [...cancelWaits]) cancel();
      if (prototype._initGlslangAsync === wrapped) prototype._initGlslangAsync = original;
    },
  };
}

function close() { active?.close(); active = undefined; }

function main(editor) {
  close();
  // The Editor's official module override supplies its own UMD Babylon build.
  const { WebGPUEngine, EngineStore } = require("babylonjs");
  const { join } = require("path"), { readFileSync } = require("fs"), { createHash } = require("crypto");
  const writerPath = join(editor.path, "build/src/project/tools/geometry.js");
  const editorVersion = JSON.parse(readFileSync(join(editor.path, "package.json"), "utf8")).version;
  const geometry = installGeometryCompatibility(require(writerPath), {
    editorVersion, babylonVersion: WebGPUEngine.Version,
    writerSha256: createHash("sha256").update(readFileSync(writerPath)).digest("hex"),
  });
  let compiler;
  try { compiler = installCompilerCompatibility(WebGPUEngine, [...EngineStore.Instances]); }
  catch (error) { geometry.close(); throw error; }
  const installation = { ready: compiler.ready, close() { geometry.close(); compiler.close(); } };
  active = installation;
  installation.ready.then(retried => {
    if (active === installation) editor.layout.console.log(`${title} ready; retried ${retried} stalled GLSL effects.`);
  }, error => {
    if (active !== installation) return;
    editor.layout.console.error(`${title} failed: ${error?.message ?? String(error)}`);
    console.error(error);
  });
  return installation.ready;
}

module.exports = { title, description, main, close, installCompilerCompatibility };
