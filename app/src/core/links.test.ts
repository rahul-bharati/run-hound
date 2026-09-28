/**
 * The address of each check's page on Run Hound's public site (DESIGN.md §5.5): every built-in check links to
 * /checks/<id>/, the optional ai-flow to its card on the checks hub (/checks/#ai-flow). A link is built from the check id
 * alone, so it never carries run data. The site tests the same mapping against its route registry
 * (site/src/lib/app-links.test.ts), so a renamed route or check fails CI on both sides.
 */
import { describe, expect, it } from "vitest";
import { CHECK_IDS } from "./types.js";
import { SITE_URL, checkPageUrl } from "./links.js";

describe("SITE_URL", () => {
  it("is the public site's https origin, with no trailing slash, path, query or fragment", () => {
    expect(SITE_URL).toBe("https://run-hound.rahulbharati.com");
    const url = new URL(SITE_URL);
    expect(url.protocol).toBe("https:");
    expect(url.origin).toBe(SITE_URL);
    expect(SITE_URL.endsWith("/")).toBe(false);
  });
});

describe("checkPageUrl", () => {
  const builtIn = CHECK_IDS.filter((id) => id !== "ai-flow");

  it("covers every check id: 26 built-in checks plus ai-flow", () => {
    expect(builtIn).toHaveLength(26);
    expect(CHECK_IDS).toContain("ai-flow");
  });

  it.each(builtIn)("maps %s to its own page, /checks/<id>/", (id) => {
    expect(checkPageUrl(id)).toBe(`${SITE_URL}/checks/${id}/`);
    const url = new URL(checkPageUrl(id));
    expect(url.origin).toBe(SITE_URL);
    expect(url.pathname).toBe(`/checks/${id}/`);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });

  it("maps ai-flow to its card on the checks hub", () => {
    expect(checkPageUrl("ai-flow")).toBe(`${SITE_URL}/checks/#ai-flow`);
  });

  it("gives every check a different address", () => {
    expect(new Set(CHECK_IDS.map(checkPageUrl)).size).toBe(CHECK_IDS.length);
  });

  it("keeps slashes, a query and a fragment in an unexpected id (one outside CHECK_IDS) out of the URL", () => {
    for (const id of ["../../admin", "a/b?token=x#y", "x y", '"><img src=x>']) {
      const url = new URL(checkPageUrl(id));
      expect(url.origin, id).toBe(SITE_URL);
      expect(url.pathname.startsWith("/checks/"), id).toBe(true);
      expect(url.pathname.slice("/checks/".length).replace(/\/$/, ""), id).not.toContain("/");
      expect(url.search, id).toBe("");
      expect(url.hash, id).toBe("");
    }
  });

  it("lets the dot segments '.' and '..' resolve like paths, so callers link only ids in CHECK_IDS", () => {
    // encodeURIComponent leaves dots alone: "." lands on the checks hub and ".." on the site's root. report.ts and the
    // web UI (client.ts) link a finding only when its check id is in CHECK_IDS, and no check id is made of dots.
    expect(new URL(checkPageUrl(".")).href).toBe(`${SITE_URL}/checks/`);
    expect(new URL(checkPageUrl("..")).href).toBe(`${SITE_URL}/`);
    for (const id of CHECK_IDS) expect(id).not.toMatch(/^\.+$/);
  });
});
