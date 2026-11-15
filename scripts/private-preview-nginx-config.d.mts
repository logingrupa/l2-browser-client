export type PrivatePreviewMode = "static" | "dev";

export declare const devServerPort: number;
export declare const privatePreviewModes: readonly PrivatePreviewMode[];
export declare const privatePreviewRedirectPathByMode: Readonly<Record<PrivatePreviewMode, string>>;
export declare function slash(value: string): string;

export interface PrivatePreviewNginxConfigInputs {
  key: string;
  mode: string;
  pidFile: string;
  directory: string;
  nginxExecutable: string;
  distDirectory: string;
  cookieName: string;
  hostname: string;
  port: number;
}

export declare function buildPrivatePreviewNginxConfig(inputs: PrivatePreviewNginxConfigInputs): string;
