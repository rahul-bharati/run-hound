import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

/**
 * Brand contract for the local UI (docs/brand.md): the mint accent #5EE6A3, no old amber #F5B642 except as the
 * medium/warn colour token, and the Run Hound mark as an <img alt="Run Hound"> embedded as a data URI (works offline).
 */
async function uiHtml(): Promise<string> {
  const res = await createApp({ canShowBrowser: false }).request("http://localhost/");
  expect(res.status).toBe(200);
  return res.text();
}

describe("local UI brand", () => {
  it("uses the mint accent", async () => {
    expect((await uiHtml()).toLowerCase()).toContain("#5ee6a3");
  });

  it("keeps the old amber only as the warn token", async () => {
    const html = (await uiHtml()).toLowerCase();
    const withoutWarnToken = html.replace(/--warn\s*:\s*#f5b642/g, "");
    expect(withoutWarnToken).not.toContain("#f5b642");
    expect(html).not.toMatch(/--amber\b/);
  });

  it("shows the logo mark as an embedded image named Run Hound", async () => {
    const html = await uiHtml();
    const img = /<img\b[^>]*\balt="Run Hound"[^>]*>/.exec(html);
    expect(img, "an <img alt=\"Run Hound\">").not.toBeNull();
    expect(img![0]).toMatch(/src="data:image\/png;base64,[A-Za-z0-9+/=]{100,}"/);
  });
});
