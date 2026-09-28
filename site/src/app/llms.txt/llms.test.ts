// llms.txt describes release 0.6.0 as built (the 0.6.0 verification, verify-060 site item 2): its intro and the
// signed-in runs guide's note name the write-side checks and the new sign-in forms, not only 0.5.0's access and CSRF
// checks.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { intro, linkSections } from "./llms";

describe("llms.txt: the V2 preview as 0.6.0 built it", () => {
  test("the intro names the write-side checks and the sign-in forms", () => {
    const text = intro();
    for (const words of ["write-access", "paywall-trust", "csrf", "email first", "sessionStorage"]) assert.ok(text.includes(words), words);
  });

  test("the signed-in runs guide's note names the write-side checks", () => {
    const note = linkSections.flatMap((s) => s.links).find((l) => l.name === "docs/signed-in-runs.md")?.note ?? "";
    for (const words of ["write-access", "paywall-trust", "csrf"]) assert.ok(note.includes(words), `${words} in "${note}"`);
  });
});
