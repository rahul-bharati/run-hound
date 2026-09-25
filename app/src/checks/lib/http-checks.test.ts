import { describe, expect, it } from "vitest";
import type { Capture } from "../../core/types.js";
import { documentResponse, headerLines, looksLikeDevServer, worst } from "./http-checks.js";

const capture = (...urls: string[]): Capture => ({
  requests: urls.map((url) => ({ url, method: "GET", resourceType: "script", postData: null, status: 200, failure: null, responseBody: null })),
  console: [],
  pageErrors: [],
});

describe("looksLikeDevServer", () => {
  // Real URLs seen from each dev server.
  it.each([
    ["Vite", "http://localhost:5173/@vite/client"],
    ["Vite React refresh", "http://localhost:5173/@react-refresh"],
    ["Vite deps", "http://localhost:5173/node_modules/.vite/deps/react.js?v=1a2b3c"],
    ["Next.js 16 Turbopack HMR client", "http://localhost:3000/_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_1mojsay._.js"],
    ["Next.js 16 devtools", "http://localhost:3000/_next/static/chunks/0n33_next_dist_compiled_next-devtools_index_1vzvjg2.js"],
    ["Next.js webpack dev", "http://localhost:3000/_next/static/chunks/webpack.js"],
    ["Next.js webpack dev main-app", "http://localhost:3000/_next/static/chunks/main-app.js?v=1712"],
    ["Next.js HMR socket", "http://localhost:3000/_next/webpack-hmr"],
    ["webpack dev server", "http://localhost:8080/webpack-dev-server.js"],
    ["Nuxt", "http://localhost:3000/_nuxt/@vite/client"],
    ["Astro", "http://localhost:4321/@astrojs/react/client.js"],
  ])("%s", (_name, url) => {
    expect(looksLikeDevServer(capture("http://localhost:3000/", url))).toBe(true);
  });

  // Production builds: hashed names, nothing dev-only.
  it.each([
    ["Vite build", "http://localhost:4173/assets/index-DjftFHa3.js"],
    ["Next.js production (webpack)", "http://localhost:3000/_next/static/chunks/webpack-8f2e0c1d4b.js"],
    ["Next.js production main-app", "http://localhost:3000/_next/static/chunks/main-app-2a9f3c.js"],
    ["Next.js production (Turbopack)", "http://localhost:3000/_next/static/chunks/0n33_next_dist_client_11wwo80._.js"],
    ["plain script", "http://localhost:3000/app.js"],
  ])("%s is not a dev server", (_name, url) => {
    expect(looksLikeDevServer(capture("http://localhost:3000/", url))).toBe(false);
  });
});

describe("documentResponse", () => {
  it("takes the last 2xx top-level document on the target's origin", () => {
    const c: Capture = {
      requests: [
        { url: "http://x.test/", method: "GET", resourceType: "document", postData: null, status: 302, failure: null, responseBody: null, responseHeaders: { location: "/book" } },
        { url: "http://x.test/book", method: "GET", resourceType: "document", postData: null, status: 200, failure: null, responseBody: null, responseHeaders: { "x-a": "1" } },
        { url: "http://other.test/", method: "GET", resourceType: "document", postData: null, status: 200, failure: null, responseBody: null, responseHeaders: {} },
      ],
      console: [],
      pageErrors: [],
    };
    expect(documentResponse(c, "http://x.test/")?.url).toBe("http://x.test/book");
  });
});

describe("headerLines and worst", () => {
  it("never shows a cookie's value", () => {
    const lines = headerLines({ "set-cookie": "sid=secret123; HttpOnly\ntheme=dark", "x-b": "2" }).map((l) => l.text);
    expect(lines.join("\n")).not.toContain("secret123");
    expect(lines).toContain("set-cookie: sid=… (value hidden); HttpOnly");
  });
  it("picks the most severe", () => {
    expect(worst(["low", "high", "medium"])).toBe("high");
    expect(worst([])).toBe("low");
  });
});
