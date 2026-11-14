import type { Scene } from "@babylonjs/core/scene";
import type { DiagnosticMaterialMetadata, DiagnosticMaterialRecord } from "./material";

export function visibleDiagnosticMaterials(scene: Scene): DiagnosticMaterialRecord[] {
  const diagnosticsByRoot = new Map<string, DiagnosticMaterialRecord>();
  for (const mesh of scene.meshes) {
    if (!mesh.isEnabled() || !mesh.isVisible) continue;
    const materialMetadata: Partial<DiagnosticMaterialMetadata> | null = mesh.material?.metadata ?? null;
    const diagnostic = materialMetadata?.ue2Diagnostic;
    if (diagnostic && !diagnosticsByRoot.has(diagnostic.root)) diagnosticsByRoot.set(diagnostic.root, diagnostic);
  }
  return [...diagnosticsByRoot.values()]
    .sort((left, right) => left.root < right.root ? -1 : 1)
    .map(({ root, unportedClass, reasons }) => ({ root, unportedClass, reasons: [...reasons] }));
}
