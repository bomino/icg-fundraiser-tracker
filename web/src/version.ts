/** The API_VERSION of the Code.gs this site was built with; vite.config.ts reads it from apps-script/Code.gs. */
export const SITE_API_VERSION: number = __API_VERSION__;
/** The commit the site was built from, shortened as GitHub shows it, or '' for a build made outside GitHub Actions. */
export const SITE_COMMIT: string = __BUILD_SHA__.slice(0, 7);

/** The half of the tracker that is out of date: the server needs redeploying, the site a page reload. */
export type BehindHalf = 'server' | 'site' | null;

// A Code.gs deployed before API_VERSION existed sends none, so it counts as the older one.
export function behindHalf(serverVersion: number | undefined, siteVersion: number = SITE_API_VERSION): BehindHalf {
  if (serverVersion === undefined || serverVersion < siteVersion) return 'server';
  return serverVersion > siteVersion ? 'site' : null;
}
