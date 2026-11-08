/* Stage 1 HCOT viewer access: a narrow, explicit read-only allowlist.
   All requests still require verified Cloudflare Access authentication upstream.
   Every other HCOT route and method requires HCOT administrator authorization. */
const VIEWER_READ_PATHS = new Set([
  '/hcot/access-session',
  '/hcot/plans',
  '/hcot/calendar',
  '/hcot/competencies',
])
export function isHcotViewerRead(method: string, path: string): boolean {
  return method.toUpperCase() === 'GET' && VIEWER_READ_PATHS.has(path)
}
