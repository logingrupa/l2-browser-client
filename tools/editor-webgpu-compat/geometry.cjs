"use strict";

// Exact Editor 5.5.3 project/tools/geometry.js, shared by Save and Play/export.
// Review this adapter against the installed writer before any Editor upgrade.
const WRITER_SHA256 = "1b86dac8db1685491e703a1984b60b923478d551df47ec2a36cd39c648aa5a06";

function installGeometryCompatibility(writerModule, versions) {
  if (versions?.editorVersion !== "5.5.3" || versions?.babylonVersion !== "9.27.1" || versions?.writerSha256 !== WRITER_SHA256) {
    throw new Error("Editor UV2 compatibility requires Editor 5.5.3, Babylon 9.27.1 and the reviewed binary writer.");
  }
  const original = writerModule?.writeBinaryGeometry;
  if (typeof original !== "function") throw new Error("Expected Editor binary geometry writer is missing.");

  function validate(values, positions) {
    if ((!Array.isArray(values) && !ArrayBuffer.isView(values)) || !Number.isInteger(values.length) ||
        !positions || positions.length % 3 !== 0 || values.length !== positions.length / 3 * 2 ||
        !Array.from(values).every(Number.isFinite)) {
      throw new Error("Editor UV2 must contain one finite coordinate pair per vertex.");
    }
  }

  const wrapped = function (options, ...args) {
    const geometry = options?.geometry;
    if (!geometry) return original.call(this, options, ...args);
    const canonical = geometry.uvs2, legacy = geometry.uv2s;
    if (canonical == null && legacy == null) return original.call(this, options, ...args);
    if (canonical != null) validate(canonical, geometry.positions);
    if (legacy != null) validate(legacy, geometry.positions);
    if (canonical != null && legacy != null &&
        (canonical.length !== legacy.length || Array.from(canonical).some((value, index) => !Object.is(value, legacy[index])))) {
      throw new Error("Conflicting Editor uvs2/uv2s channels; refusing to discard authored UV2.");
    }
    // Only adapt the consumer's spelling. The serializer's input remains intact;
    // the real writer still owns mesh descriptors, packing and stream lifetime.
    return original.call(this, canonical == null ? options : {
      ...options, geometry: { ...geometry, uv2s: canonical },
    }, ...args);
  };
  writerModule.writeBinaryGeometry = wrapped;
  return { close() {
    if (writerModule.writeBinaryGeometry === wrapped) writerModule.writeBinaryGeometry = original;
  } };
}

module.exports = { installGeometryCompatibility, WRITER_SHA256 };
