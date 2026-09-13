// Browser-side globals shared by the runtime files in this folder. These files are bundled with
// esbuild into generated apps (sdk.ts, mount.tsx) or served as /runtime assets (bridge.ts).
import type { BuildErrorInfo, SayShipConfig } from "../../shared/preview";

declare global {
  interface SayShipBridge {
    reportError(error: unknown, extra?: { componentStack?: string }): void;
    ready(): void;
    buildFailed(errors: BuildErrorInfo[]): void;
  }

  interface Window {
    __SAYSHIP__?: SayShipConfig;
    __sayship?: SayShipBridge;
    __sayship_modules?: Record<string, unknown>;
  }
}

export {};
