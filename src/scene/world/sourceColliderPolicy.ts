// Adapted from the audited local Lineagen terrain preview; see docs/WORLD_ASSETS.md.
/** Narrow recovery of disabled Unity collider components, not a material heuristic.
 * Evidence and source hashes: docs/WEAPONS_SHOP_DOORWAY.md.
 * Unknown/revised placements keep the conservative triangle collider.
 */
interface SourceColliderModel {
  id: string; file: string; sha256?: string; sourceFbxSha256?: string;
  materialGuids?: string[];
}
interface SourceColliderPlacement {
  id: string; position: number[]; rotationQuaternion: number[]; scale: number[];
}
const arDisabled = [
  { id: '17_25:static:1388874679683410040', component: '6858508977984017953',
    position: [4627.2294921875, -69.52545928955078, 1642.397705078125],
    rotationQuaternion: [0, -0.9700312614440918, 0, 0.2429802119731903],
    scale: [1.0000001192092896, 1, 1.0000001192092896] },
  { id: '17_25:static:1418106589461262558', component: '4901888369149689774',
    position: [4622.86767578125, -69.52545928955078, 1647.6593017578125],
    rotationQuaternion: [0, -0.8819212317466736, 0, 0.4713967740535736],
    scale: [1.0000001192092896, 1, 1.0000001192092896] },
];

export function fnDisabledSourceCollider(obModel: SourceColliderModel, obPlacement: SourceColliderPlacement): string | null {
  if (obModel.id !== 'interior_B_126_33b3ce50ad' || obModel.file !== 'interior_B_126_33b3ce50ad.glb' ||
      obModel.sha256 !== '27448f813eeac09ce419c5512ef2f3f5876020de290689008c80d7dca8b53456' ||
      obModel.sourceFbxSha256 !== 'a61188d3057fe4864922c09a28d07eb50b9cf296426749f785affcdc0b9d4b29' ||
      obModel.materialGuids?.length !== 1 || obModel.materialGuids[0] !== 'fb76b08a21e792848af0fcfa7fdf2e36') return null;
  const obSource = arDisabled.find(obEntry => obEntry.id === obPlacement.id);
  const fnSame = (arActual: number[], arExpected: number[]) => arActual.length === arExpected.length && arActual.every((fValue, nIndex) => fValue === arExpected[nIndex]);
  return obSource && fnSame(obPlacement.position, obSource.position) && fnSame(obPlacement.rotationQuaternion, obSource.rotationQuaternion) && fnSame(obPlacement.scale, obSource.scale)
    ? obSource.component : null;
}
