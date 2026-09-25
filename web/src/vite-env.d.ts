interface ImportMetaEnv {
  readonly VITE_SCRIPT_URL?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
/** Filled in by vite.config.ts's `define`. */
declare const __API_VERSION__: number;
/** The commit the site was built from, or '' outside GitHub Actions. */
declare const __BUILD_SHA__: string;
