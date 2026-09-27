// Unit tests for components/faq/data.ts: the FAQ's questions, answers and FAQPage structured data. `pnpm test`.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

// A deployed address, with the trailing slash that every URL must drop. Set before lib/site.ts reads it.
process.env.NEXT_PUBLIC_SITE_URL = "https://run-hound.example/";
const { site } = await import("@/lib/site");
const { answerText, faqGroups, faqItems, faqJsonLd, faqPage, plainText } = await import("@/components/faq/data");

const base = "https://run-hound.example";

describe("faq", () => {
  test("has 8 to 12 questions with unique ids, in the groups' order", () => {
    assert.ok(faqItems.length >= 8 && faqItems.length <= 12, `${faqItems.length} questions`);
    const ids = [...faqGroups.map((group) => group.id), ...faqItems.map((item) => item.id)];
    assert.equal(new Set(ids).size, ids.length, "ids (groups and questions) are unique on the page");
    for (const item of faqItems) assert.match(item.id, /^[a-z0-9-]+$/);
  });

  test("every question ends with a question mark and every answer has a link to the details", () => {
    for (const item of faqItems) {
      assert.ok(item.q.endsWith("?"), item.q);
      assert.ok(item.a.length > 0 && item.links.length > 0, item.id);
      for (const link of item.links) {
        // Internal paths end with "/" (trailingSlash), optionally followed by an anchor; sources are https.
        assert.match(link.href, /^(\/([a-z0-9-]+\/)*(#[a-z0-9-]+)?|https:\/\/.+)$/, link.href);
      }
    }
  });

  test("answers balance their code marks, and the plain text drops them", () => {
    for (const item of faqItems) {
      for (const paragraph of item.a) assert.equal((paragraph.match(/`/g) ?? []).length % 2, 0, paragraph);
      assert.ok(!answerText(item).includes("`"), item.id);
    }
    assert.equal(plainText("open `http://localhost:4000` now"), "open http://localhost:4000 now");
  });

  test("the description fits a search snippet", () => {
    assert.ok(faqPage.description.length <= 155, `${faqPage.description.length} characters`);
  });

  test("the structured data is one FAQPage with the visible questions and answers, and its breadcrumb", () => {
    const data = faqJsonLd();
    assert.equal(data["@context"], "https://schema.org");
    const [page, breadcrumb, ...rest] = data["@graph"];
    assert.equal(rest.length, 0);
    assert.equal(page["@type"], "FAQPage");
    assert.equal(page["@id"], `${base}/faq/#webpage`);
    assert.equal(page.url, `${base}/faq/`);
    assert.equal(page.name, "FAQ: UI testing for AI-built apps · Run Hound");
    assert.equal(page.description, faqPage.description);
    assert.equal(page.dateModified, site.releasedIso);
    assert.deepEqual(
      page.mainEntity,
      faqItems.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: answerText(item) },
      })),
    );
    assert.equal(breadcrumb["@type"], "BreadcrumbList");
    assert.deepEqual(
      (breadcrumb.itemListElement as { name: string; item: string }[]).map(({ name, item }) => [name, item]),
      [
        ["Home", `${base}/`],
        ["FAQ", `${base}/faq/`],
      ],
    );
  });
});
