export declare const privatePreviewHostname: string;
export declare const privatePreviewOrigin: string;
export declare const privatePreviewWorldPath: string;
export declare const privatePreviewCatalogPath: string;

export interface PrivatePreviewSectionRecord { manifest: string; manifestSha256: string }
export interface PrivatePreviewSectionManifest {
  terrain: { file: string };
  terrainPatches?: { model: { file: string } }[];
  models: { model: { file: string } }[];
  bsp?: { model: { file: string } }[];
}

export declare function nativeSectionManifestPath(sectionRecord: PrivatePreviewSectionRecord): string;
export declare function nativeSectionResourcePaths(sectionRecord: PrivatePreviewSectionRecord, sectionManifest: PrivatePreviewSectionManifest): string[];
