import { createTerrainLegacyReferenceRenderer, type TerrainLegacyReceipt } from "./terrainLegacyReferenceRenderer";
import { terrainReferenceCases, TERRAIN_REFERENCE_BYTE_TOLERANCE } from "./terrainLegacyReferenceCases";
import { terrainUvReferenceCases, type TerrainUvCaseMetadata } from "./terrainUvReferenceCases";

const canvas = document.getElementById("gpu"), status = document.getElementById("status"), cases = document.getElementById("cases");
if (!(canvas instanceof HTMLCanvasElement) || !status || !cases) throw new Error("Missing reference fixture elements.");
interface CaseResult {
  id: string; description: string; expectedRgba: readonly number[]; actualRgba: number[];
  maximumByteError: number; pass: boolean; receipt: TerrainLegacyReceipt;
  uvCase: TerrainUvCaseMetadata | null;
}
const state = {
  ready: false, failure: null as string | null, cases: [] as CaseResult[],
  byteTolerance: TERRAIN_REFERENCE_BYTE_TOLERANCE, classification: "synthetic-explicit-state-reference-not-native-parity",
};
declare global { interface Window { __terrainLegacyReference?: { snapshot(): typeof state }; } }
window.__terrainLegacyReference = { snapshot: () => state };
const uvOnly = document.getElementById("uv-only");
if (uvOnly instanceof HTMLInputElement) uvOnly.addEventListener("change", () => document.body.classList.toggle("uv-only", uvOnly.checked));
void (async () => {
  const renderer = createTerrainLegacyReferenceRenderer(canvas);
  try {
    for (const item of [...terrainReferenceCases, ...terrainUvReferenceCases]) {
      const receipt = await renderer.render(item.fixture);
      let maximumByteError = 0;
      for (let i = 0; i < receipt.pixels.length; i++) maximumByteError = Math.max(maximumByteError, Math.abs(receipt.pixels[i]! - item.expectedRgba[i % 4]!));
      const result: CaseResult = { id: item.fixture.id, description: item.description, expectedRgba: item.expectedRgba,
        actualRgba: receipt.pixels.slice(0, 4), maximumByteError, pass: maximumByteError <= TERRAIN_REFERENCE_BYTE_TOLERANCE, receipt,
        uvCase: "uvCase" in item ? item.uvCase as TerrainUvCaseMetadata : null };
      state.cases.push(result);
      const article = document.createElement("article"), image = document.createElement("canvas");
      image.width = receipt.width; image.height = receipt.height;
      const context = image.getContext("2d");
      if (!context) throw new Error("Missing fixture display context.");
      context.putImageData(new ImageData(new Uint8ClampedArray(receipt.pixels), receipt.width, receipt.height), 0, 0);
      const title = document.createElement("strong"), bytes = document.createElement("output"), description = document.createElement("p");
      title.textContent = `${result.pass ? "PASS" : "FAIL"} · ${result.id}`; title.className = result.pass ? "pass" : "fail";
      bytes.textContent = `RGBA ${result.actualRgba.join(", ")} · error ≤ ${result.maximumByteError} byte`;
      description.textContent = item.description;
      article.append(image, title, bytes, description); cases.append(article);
      article.dataset.suite = result.uvCase ? "uv" : "legacy";
    }
    state.ready = true;
    const failures = state.cases.filter(item => !item.pass).length;
    status.textContent = `${state.cases.length - failures}/${state.cases.length} cases passed · ${state.cases[0]?.receipt.engine.renderer ?? "unknown renderer"} · functional checks, no FPS measurement`;
    status.className = failures ? "fail" : "pass";
  } finally { renderer.dispose(); }
})().catch(error => { state.failure = String(error); status.textContent = state.failure; console.error(error); });
