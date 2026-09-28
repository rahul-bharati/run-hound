/** Run Hound's public site. A finding links to its check's page there; a link never carries run data. */
export const SITE_URL = "https://run-hound.rahulbharati.com";

/** The page that explains a check: /checks/<id>/ for the built-in checks, the hub's card for the optional ai-flow. */
export function checkPageUrl(checkId: string): string {
  return checkId === "ai-flow" ? `${SITE_URL}/checks/#ai-flow` : `${SITE_URL}/checks/${encodeURIComponent(checkId)}/`;
}
