import { describe, expect, it } from "vitest";
import { toObservation, type ObservationMeta } from "../../../src/agent/observe.js";
import { AGENT_OBSERVATION_LIMITS } from "../../../src/config/agent.js";
import { AGENT_CONTROL_ROLES, AGENT_EDITABLE_ROLES } from "../../../src/constants/agent-constants.js";
import type { ObservedNode, PageObservation } from "../../../src/interfaces/agent.js";

/**
 * toObservation: Playwright's AI-mode aria snapshot made safe to show a model (docs/agent-spec.md "Observations", and
 * the JSDoc of src/agent/observe.ts). Pure: snapshot JSON in, a PageObservation and the refs it issued out.
 *
 * Contract these tests pin down (interpretations marked *):
 * - Field values never appear anywhere in the observation. For the editable roles (AGENT_EDITABLE_ROLES) the node's
 *   `text` is replaced by `filled: true` (it held a value) or `filled: false`. A select's options become `options`
 *   (at most 20 labels, in order) with no marker of which one is selected.
 *   * An empty-string text counts as no value (filled false). A combobox's own `filled` is not tested when it is a
 *     select (its value is in the option children, not in a text). An option label goes through `hide` too (it is
 *     text the model sees, though the spec says "name and text"). What happens to the option children besides
 *     `options` is not tested, only that nothing says which one is selected.
 * - Refs are "<meta.number>.<playwright ref>"; the returned Map maps each model-visible ref to Playwright's. The Map
 *   holds exactly the refs that appear in the tree (* a flattened wrapper issues none). An iframe is a node without
 *   its content, so none of the refs inside it ("f1e2") is issued.
 * - Text fragments (bare strings among the children) are joined into the parent's `text`.
 *   * Joined with a space (the test accepts any whitespace). Where a generic wrapper whose only text is a fragment
 *     ends up (flattened, or kept with that text) is not tested.
 * - Every name and text goes through `hide` first, then is cut to AGENT_OBSERVATION_LIMITS (120 / 200 characters).
 *   * "Cut" means the result is at most the limit and starts with the original's first (limit - 1) characters, so a
 *     trailing ellipsis within the limit is accepted. Text of exactly the limit is left as it is.
 * - Wrappers: a `generic` with no name or text and no `cursor: "pointer"` is replaced by its children (in place, in
 *   order). A generic with a name, with text, or with cursor "pointer" stays; other roles (main, list) stay even
 *   unnamed. * An empty wrapper with no children disappears.
 * - Links: a same-origin link shows its path (no query, no hash), another origin shows its origin only. * A port is part
 *   of the origin.
 * - Destructive controls: a button, link or menu item (AGENT_CONTROL_ROLES) for which isDestructiveControl is true,
 *   sign-out controls included, gets `destructive: true`; ordinary ones and other roles don't.
 * - Size: nodes are kept depth first until AGENT_OBSERVATION_LIMITS.nodes (400) or .totalChars (24,000) of JSON;
 *   past that, `truncated` is true.
 *   * A parent counts as one node and its children come after it. Exactly 400 nodes is not truncated. The characters
 *     counted are the tree's JSON; the test allows the 2 brackets of the list (and a few characters) over the limit,
 *     and checks the cut is where the next node would not have fitted.
 * - path, title, status, problems and dialog are copied from `meta`.
 * - Anything that isn't a node (a value without a string `role`) is ignored, and nothing the page sends makes it throw.
 */

const META: ObservationMeta = {
  number: 3,
  origin: "http://localhost:4173",
  path: "/app/profile",
  title: "Profile settings",
  status: 200,
  problems: { consoleErrors: 0, pageErrors: 0, failedRequests: 0 },
  dialog: null,
};

type Hide = (text: string) => string;
const identity: Hide = (text) => text;

function observe(snapshot: unknown, meta: Partial<ObservationMeta> = {}, hide: Hide = identity) {
  return toObservation(snapshot, { ...META, ...meta }, hide);
}

/** Every node of the tree, depth first (a parent before its children). */
function walk(nodes: ObservedNode[] | undefined): ObservedNode[] {
  return (nodes ?? []).flatMap((node) => [node, ...walk(node.children)]);
}

function find(observation: PageObservation, role: string, name?: string): ObservedNode | undefined {
  return walk(observation.tree).find((node) => node.role === role && (name === undefined || node.name === name));
}

function got(node: ObservedNode | undefined, what: string): ObservedNode {
  if (!node) throw new Error(`expected the observation to hold ${what}`);
  return node;
}

/** The snapshot from the maintainer's notes on Playwright 1.63's page.ariaSnapshotJSON({ mode: "ai" }). */
const REALISTIC = [
  {
    role: "main",
    ref: "e2",
    children: [
      { role: "heading", name: "Profile", level: 1, ref: "e3" },
      { role: "generic", ref: "e4", children: ["Bio", { role: "textbox", name: "Bio", ref: "e5", text: "secret-bio-value" }] },
      { role: "generic", ref: "e6", children: ["Password", { role: "textbox", name: "Password", ref: "e7", text: "hunter2hunter2" }] },
      {
        role: "generic",
        ref: "e8",
        children: [
          "Plan",
          { role: "combobox", name: "Plan", ref: "e9", children: [{ role: "option", name: "Free" }, { role: "option", name: "Pro", selected: true }] },
        ],
      },
      { role: "generic", ref: "e10", children: [{ role: "checkbox", name: "Email me", checked: true, ref: "e11" }, "Email me"] },
      { role: "button", name: "Save", disabled: true, ref: "e12" },
      { role: "button", name: "Delete account", ref: "e13" },
      { role: "link", name: "Docs", ref: "e14", cursor: "pointer", url: "https://other.example/x?token=abc" },
      { role: "link", name: "Help", ref: "e15", cursor: "pointer", url: "/app/help?x=1#h" },
      {
        role: "list",
        ref: "e16",
        children: [
          { role: "listitem", ref: "e17", text: "Buy milk" },
          { role: "listitem", ref: "e18", children: [{ role: "strong", ref: "e19", text: "Walk" }, "the dog"] },
        ],
      },
      { role: "status", ref: "e20", text: "Saved!" },
      { role: "iframe", ref: "e21", children: [{ role: "button", name: "Inner", ref: "f1e2" }] },
    ],
  },
];

describe("a realistic snapshot", () => {
  it("shows the page's controls with their state, and never a field's value", () => {
    const { observation } = observe(REALISTIC);
    const json = JSON.stringify(observation);
    expect(json).not.toContain("secret-bio-value");
    expect(json).not.toContain("hunter2hunter2");

    expect(got(find(observation, "textbox", "Bio"), "the Bio field")).toMatchObject({ ref: "3.e5", filled: true });
    expect(got(find(observation, "textbox", "Password"), "the Password field")).toMatchObject({ ref: "3.e7", filled: true });
    expect(find(observation, "heading", "Profile")).toMatchObject({ ref: "3.e3", level: 1 });
    expect(find(observation, "checkbox", "Email me")).toMatchObject({ ref: "3.e11", checked: true });
    expect(find(observation, "button", "Save")).toMatchObject({ ref: "3.e12", disabled: true });
    expect(find(observation, "status")).toMatchObject({ ref: "3.e20", text: "Saved!" });
    expect(find(observation, "listitem", undefined)?.text).toBe("Buy milk");
    expect(observation.truncated).toBe(false);
  });

  it("lists a select's options without saying which is selected", () => {
    const { observation } = observe(REALISTIC);
    const plan = got(find(observation, "combobox", "Plan"), "the Plan select");
    expect(plan.options).toEqual(["Free", "Pro"]);
    expect(JSON.stringify(plan)).not.toContain("selected");
    expect(plan.ref).toBe("3.e9");
  });

  it("marks the destructive button, not the ordinary ones, and shortens links", () => {
    const { observation } = observe(REALISTIC);
    expect(find(observation, "button", "Delete account")?.destructive).toBe(true);
    expect(find(observation, "button", "Save")?.destructive).toBeFalsy();
    expect(find(observation, "link", "Docs")?.url).toBe("https://other.example");
    expect(find(observation, "link", "Help")?.url).toBe("/app/help");
  });

  it("folds text fragments into the parent's text, and shows the iframe without its content", () => {
    const { observation } = observe(REALISTIC);
    const dog = walk(observation.tree).find((node) => node.ref === "3.e18");
    expect(dog?.text).toBe("the dog");
    expect(walk(observation.tree).find((node) => node.ref === "3.e19")).toMatchObject({ role: "strong", text: "Walk" });

    const frame = got(find(observation, "iframe"), "the iframe");
    expect(frame.children ?? []).toEqual([]);
    expect(JSON.stringify(observation)).not.toContain("Inner");
    expect(JSON.stringify(observation)).not.toContain("f1e2");
  });

  it("issues exactly the refs it shows, as <observation>.<ref> mapped to Playwright's", () => {
    const { observation, refs } = observe(REALISTIC);
    const shown = walk(observation.tree).map((node) => node.ref);
    expect([...refs.keys()].sort()).toEqual([...shown].sort());
    expect(refs.get("3.e5")).toBe("e5");
    expect(refs.get("3.e12")).toBe("e12");
    expect(refs.get("3.e21")).toBe("e21");
    for (const [model, playwright] of refs) expect(model).toBe(`3.${playwright}`);
    expect([...refs.values()]).not.toContain("f1e2");
  });
});

describe("field values never leave", () => {
  it.each(AGENT_EDITABLE_ROLES)("%s: a value becomes filled: true and its text is gone", (role) => {
    const { observation } = observe([{ role, name: "Field", ref: "e5", text: "VALUE-the-user-typed-123" }]);
    const node = got(find(observation, role, "Field"), `a ${role}`);
    expect(node.filled).toBe(true);
    expect(node.text).toBeUndefined();
    expect(JSON.stringify(observation)).not.toContain("VALUE-the-user-typed-123");
  });

  it.each(AGENT_EDITABLE_ROLES)("%s: no value (or an empty one) is filled: false", (role) => {
    const { observation } = observe([
      { role, name: "Empty", ref: "e5" },
      { role, name: "Blank", ref: "e6", text: "" },
    ]);
    expect(got(find(observation, role, "Empty"), "a field").filled).toBe(false);
    expect(got(find(observation, role, "Blank"), "a field with an empty text").filled).toBe(false);
  });

  it("keeps the text of roles that aren't editable, and gives them no filled flag", () => {
    const { observation } = observe([
      { role: "status", ref: "e1", text: "Saved!" },
      { role: "listitem", ref: "e2", text: "Buy milk" },
      { role: "button", name: "Save", ref: "e3" },
      { role: "checkbox", name: "Email me", ref: "e4", checked: true },
    ]);
    expect(find(observation, "status")?.text).toBe("Saved!");
    expect(find(observation, "listitem")?.text).toBe("Buy milk");
    for (const node of walk(observation.tree)) expect(node.filled).toBeUndefined();
  });

  it("lists at most 20 options, in order, and never marks one selected", () => {
    const options = Array.from({ length: 25 }, (_, i) => ({ role: "option", name: `Plan ${i + 1}`, ...(i === 7 ? { selected: true } : {}) }));
    const { observation } = observe([{ role: "combobox", name: "Plan", ref: "e9", children: options }]);
    const select = got(find(observation, "combobox", "Plan"), "the select");
    expect(select.options).toEqual(Array.from({ length: 20 }, (_, i) => `Plan ${i + 1}`));
    expect(select.selected).toBeUndefined();
    expect(JSON.stringify(select)).not.toContain("selected");
  });

  it("applies hide to the option labels too *", () => {
    const hide: Hide = (text) => text.replaceAll("ACME-SECRET", "[hidden]");
    const { observation } = observe(
      [{ role: "combobox", name: "Owner", ref: "e9", children: [{ role: "option", name: "Ana" }, { role: "option", name: "ACME-SECRET" }] }],
      {},
      hide,
    );
    expect(got(find(observation, "combobox", "Owner"), "the select").options).toEqual(["Ana", "[hidden]"]);
  });
});

describe("refs", () => {
  it.each([1, 4, 12])("prefixes each ref with the observation's number (%i) and maps it back to Playwright's", (number) => {
    const { observation, refs } = observe(
      [{ role: "main", ref: "e2", children: [{ role: "button", name: "Save", ref: "e17" }, { role: "link", name: "Docs", ref: "e18", url: "/docs" }] }],
      { number },
    );
    expect(find(observation, "button", "Save")?.ref).toBe(`${number}.e17`);
    expect(find(observation, "link", "Docs")?.ref).toBe(`${number}.e18`);
    expect(refs.get(`${number}.e17`)).toBe("e17");
    expect(refs.get(`${number}.e18`)).toBe("e18");
    expect(refs.get(`${number}.e2`)).toBe("e2");
    expect(refs.size).toBe(3);
  });

  it("issues no ref for the elements inside an iframe, and shows the iframe without them", () => {
    const { observation, refs } = observe([
      {
        role: "iframe",
        ref: "e21",
        children: [{ role: "generic", ref: "f1e1", children: [{ role: "button", name: "Pay inside the frame", ref: "f1e2" }] }],
      },
      { role: "button", name: "Outside", ref: "e22" },
    ]);
    expect(find(observation, "iframe")?.children ?? []).toEqual([]);
    expect(find(observation, "button", "Outside")?.ref).toBe("3.e22");
    expect(JSON.stringify(observation)).not.toContain("Pay inside the frame");
    expect(JSON.stringify(observation)).not.toContain("f1e");
    expect([...refs.keys(), ...refs.values()].join(" ")).not.toContain("f1e");
  });

  it("returns an empty map for an empty page", () => {
    const { observation, refs } = observe([]);
    expect(observation.tree).toEqual([]);
    expect(refs.size).toBe(0);
    expect(observation.truncated).toBe(false);
  });
});

describe("text", () => {
  it("joins the text fragments among a node's children into its text", () => {
    const { observation } = observe([
      { role: "paragraph", ref: "e1", children: ["Hello", { role: "strong", ref: "e2", text: "bold" }, "world"] },
    ]);
    const paragraph = got(find(observation, "paragraph"), "the paragraph");
    expect(paragraph.text).toMatch(/^Hello\s+world$/);
    expect(find(observation, "strong")?.text).toBe("bold");
  });

  it("applies hide to every name and text, including joined fragments", () => {
    const hide: Hide = (text) => text.replaceAll("ACME-SECRET", "[hidden]");
    const { observation } = observe(
      [
        { role: "heading", name: "Welcome ACME-SECRET", level: 1, ref: "e1" },
        { role: "status", ref: "e2", text: "Signed in as ACME-SECRET" },
        { role: "paragraph", ref: "e3", children: ["Owner:", "ACME-SECRET"] },
        { role: "button", name: "ACME-SECRET's profile", ref: "e4" },
      ],
      {},
      hide,
    );
    expect(JSON.stringify(observation)).not.toContain("ACME-SECRET");
    expect(find(observation, "heading")?.name).toBe("Welcome [hidden]");
    expect(find(observation, "status")?.text).toBe("Signed in as [hidden]");
    expect(find(observation, "paragraph")?.text).toMatch(/^Owner:\s+\[hidden\]$/);
    expect(find(observation, "button")?.name).toBe("[hidden]'s profile");
  });

  it("cuts a name to the name limit and a text to the text limit", () => {
    const { nameChars, textChars } = AGENT_OBSERVATION_LIMITS;
    const name = "n".repeat(nameChars + 80);
    const text = "t".repeat(textChars + 150);
    const { observation } = observe([
      { role: "button", name, ref: "e1" },
      { role: "status", ref: "e2", text },
    ]);
    const cutName = find(observation, "button")?.name ?? "";
    const cutText = find(observation, "status")?.text ?? "";
    expect(cutName.length).toBeLessThanOrEqual(nameChars);
    expect(cutName.length).toBeGreaterThanOrEqual(nameChars - 1);
    expect(cutName.startsWith(name.slice(0, nameChars - 1))).toBe(true);
    expect(cutText.length).toBeLessThanOrEqual(textChars);
    expect(cutText.length).toBeGreaterThanOrEqual(textChars - 1);
    expect(cutText.startsWith(text.slice(0, textChars - 1))).toBe(true);
  });

  it("leaves a name or text of exactly the limit as it is", () => {
    const { nameChars, textChars } = AGENT_OBSERVATION_LIMITS;
    const name = "n".repeat(nameChars);
    const text = "t".repeat(textChars);
    const { observation } = observe([
      { role: "button", name, ref: "e1" },
      { role: "status", ref: "e2", text },
    ]);
    expect(find(observation, "button")?.name).toBe(name);
    expect(find(observation, "status")?.text).toBe(text);
  });

  it("cuts a long joined text to the text limit", () => {
    const { textChars } = AGENT_OBSERVATION_LIMITS;
    const { observation } = observe([{ role: "paragraph", ref: "e1", children: ["a".repeat(150), "b".repeat(150)] }]);
    expect((find(observation, "paragraph")?.text ?? "").length).toBeLessThanOrEqual(textChars);
  });

  it("redacts before it cuts, so a secret straddling the limit leaves no half behind", () => {
    const { nameChars } = AGENT_OBSERVATION_LIMITS;
    const hide: Hide = (text) => text.replaceAll("SECRETWORD", "[hidden]");
    // Cut first, then redacted: the first 120 characters would end in "SECRE", which hide no longer recognises.
    const name = `${"a".repeat(nameChars - 5)}SECRETWORD`;
    const { observation } = observe([{ role: "button", name, ref: "e1" }], {}, hide);
    expect(JSON.stringify(observation)).not.toContain("SECRE");
    expect((find(observation, "button")?.name ?? "").length).toBeLessThanOrEqual(nameChars);
  });
});

describe("wrappers", () => {
  it("replaces a generic with no name or text by its children, in place and in order", () => {
    const { observation, refs } = observe([
      { role: "button", name: "First", ref: "e1" },
      {
        role: "generic",
        ref: "e2",
        children: [
          { role: "generic", ref: "e3", children: [{ role: "button", name: "Second", ref: "e4" }] },
          { role: "button", name: "Third", ref: "e5" },
        ],
      },
      { role: "button", name: "Fourth", ref: "e6" },
    ]);
    expect(observation.tree.map((node) => node.name)).toEqual(["First", "Second", "Third", "Fourth"]);
    expect(observation.tree.every((node) => node.role === "button")).toBe(true);
    expect(refs.has("3.e2")).toBe(false);
    expect(refs.has("3.e3")).toBe(false);
  });

  it("keeps a generic that has a name, has text, or is marked clickable", () => {
    const { observation, refs } = observe([
      { role: "generic", name: "Card", ref: "e1", children: [{ role: "button", name: "A", ref: "e2" }] },
      { role: "generic", ref: "e3", text: "Wrapper text" },
      { role: "generic", ref: "e4", cursor: "pointer", children: [{ role: "image", name: "Thumb", ref: "e5" }] },
      { role: "generic", ref: "e6", cursor: "pointer", text: "Open" },
    ]);
    const generics = observation.tree.filter((node) => node.role === "generic");
    expect(generics.map((node) => node.ref)).toEqual(["3.e1", "3.e3", "3.e4", "3.e6"]);
    expect(refs.get("3.e4")).toBe("e4");
    expect(generics.find((node) => node.ref === "3.e4")?.children?.map((node) => node.name)).toEqual(["Thumb"]);
    expect(generics.find((node) => node.ref === "3.e1")?.children?.map((node) => node.name)).toEqual(["A"]);
  });

  it("keeps other roles even when they have no name or text", () => {
    const { observation } = observe([
      { role: "main", ref: "e1", children: [{ role: "list", ref: "e2", children: [{ role: "listitem", ref: "e3", text: "One" }] }] },
    ]);
    expect(observation.tree.map((node) => node.role)).toEqual(["main"]);
    expect(find(observation, "list")?.ref).toBe("3.e2");
    expect(find(observation, "listitem")?.text).toBe("One");
  });

  it("drops an empty wrapper that has nothing inside it *", () => {
    const { observation, refs } = observe([
      { role: "generic", ref: "e1" },
      { role: "generic", ref: "e2", children: [] },
      { role: "button", name: "Go", ref: "e3" },
    ]);
    expect(observation.tree.map((node) => node.name)).toEqual(["Go"]);
    expect([...refs.keys()]).toEqual(["3.e3"]);
  });
});

describe("links", () => {
  it.each([
    ["a relative link, query and hash dropped", "/app/help?x=1#h", "/app/help"],
    ["an absolute link on the target's origin", "http://localhost:4173/app/x?token=abc#top", "/app/x"],
    ["the root path of the target", "http://localhost:4173/?utm=1", "/"],
    ["another host: its origin only", "https://other.example/x?token=abc", "https://other.example"],
    ["another port is another origin *", "http://localhost:9999/p/q?z=1", "http://localhost:9999"],
    ["another scheme is another origin *", "https://localhost:4173/p?z=1", "https://localhost:4173"],
    ["another origin with a port", "https://other.example:8443/deep/path#frag", "https://other.example:8443"],
  ])("%s", (_name, url, expected) => {
    const { observation } = observe([{ role: "link", name: "Go", ref: "e1", cursor: "pointer", url }]);
    expect(find(observation, "link")?.url).toBe(expected);
  });

  it("shows no url for a link that has none, and never a query or hash", () => {
    const { observation } = observe([
      { role: "link", name: "Nowhere", ref: "e1" },
      { role: "link", name: "Reset", ref: "e2", url: "/reset/step?token=abc123&u=me#fragment" },
    ]);
    expect(find(observation, "link", "Nowhere")?.url).toBeUndefined();
    const json = JSON.stringify(observation);
    expect(json).not.toContain("abc123");
    expect(json).not.toContain("fragment");
  });
});

describe("destructive controls", () => {
  const roles = [...AGENT_CONTROL_ROLES];

  it.each(roles.flatMap((role) => ["Delete account", "Log out", "Sign out", "Remove item"].map((name) => [role, name] as const)))(
    "a %s named \"%s\" is marked destructive",
    (role, name) => {
      const { observation } = observe([{ role, name, ref: "e1" }]);
      expect(find(observation, role, name)?.destructive).toBe(true);
    },
  );

  it.each(roles.flatMap((role) => ["Save", "Edit profile", "Next", "Docs"].map((name) => [role, name] as const)))(
    "a %s named \"%s\" is not",
    (role, name) => {
      const { observation } = observe([{ role, name, ref: "e1" }]);
      expect(find(observation, role, name)?.destructive).toBeFalsy();
    },
  );

  it("marks only controls: a heading or text that says \"Delete account\" is just text", () => {
    const { observation } = observe([
      { role: "heading", name: "Delete account", level: 2, ref: "e1" },
      { role: "status", ref: "e2", text: "Log out in 5 minutes" },
      { role: "textbox", name: "Delete", ref: "e3" },
    ]);
    for (const node of walk(observation.tree)) expect(node.destructive).toBeFalsy();
  });

});

describe("state flags", () => {
  it.each([
    ["checked", { role: "checkbox", name: "A", checked: true }],
    ["checked mixed", { role: "checkbox", name: "A", checked: "mixed" }],
    ["disabled", { role: "button", name: "A", disabled: true }],
    ["expanded", { role: "button", name: "A", expanded: true }],
    ["invalid", { role: "textbox", name: "A", invalid: true }],
    ["pressed", { role: "button", name: "A", pressed: true }],
    ["pressed mixed", { role: "button", name: "A", pressed: "mixed" }],
    ["selected", { role: "tab", name: "A", selected: true }],
    ["level", { role: "heading", name: "A", level: 3 }],
  ])("copies %s", (_label, node) => {
    const { observation } = observe([{ ...node, ref: "e1" }]);
    const shown: Record<string, unknown> = { ...got(find(observation, node.role, "A"), "the node") };
    for (const [key, value] of Object.entries(node)) {
      if (key !== "role" && key !== "name") expect(shown[key]).toEqual(value);
    }
  });

  it("does not make up flags the page didn't report", () => {
    const { observation } = observe([{ role: "button", name: "Plain", ref: "e1" }]);
    const shown = got(find(observation, "button"), "the button");
    for (const key of ["checked", "disabled", "expanded", "invalid", "pressed", "selected", "level", "filled", "options", "url"] as const) {
      expect(shown[key]).toBeUndefined();
    }
  });
});

describe("size", () => {
  const { nodes: NODE_LIMIT, totalChars } = AGENT_OBSERVATION_LIMITS;
  const items = (count: number, firstRef = 1) =>
    Array.from({ length: count }, (_, i) => ({ role: "listitem", ref: `e${firstRef + i}` }));

  it("keeps all of a page of exactly the node limit, not truncated *", () => {
    const { observation, refs } = observe(items(NODE_LIMIT));
    expect(walk(observation.tree)).toHaveLength(NODE_LIMIT);
    expect(observation.truncated).toBe(false);
    expect(refs.size).toBe(NODE_LIMIT);
  });

  it("keeps 400 nodes of a bigger page and marks it truncated", () => {
    const { observation, refs } = observe(items(NODE_LIMIT + 50));
    expect(walk(observation.tree)).toHaveLength(NODE_LIMIT);
    expect(observation.truncated).toBe(true);
    expect(refs.size).toBe(NODE_LIMIT);
    // The first ones, in page order.
    expect(observation.tree[0]?.ref).toBe("3.e1");
    expect(observation.tree[NODE_LIMIT - 1]?.ref).toBe(`3.e${NODE_LIMIT}`);
  });

  it("cuts depth first: a parent's children before the next sibling", () => {
    const { observation } = observe([
      { role: "list", ref: "e1", children: items(300, 10) },
      { role: "list", ref: "e2", children: items(300, 1000) },
    ]);
    // 1 + 300 nodes of the first list, then the second list and 98 of its children.
    expect(observation.tree).toHaveLength(2);
    expect(observation.tree[0]?.children).toHaveLength(300);
    expect(observation.tree[1]?.children).toHaveLength(NODE_LIMIT - 302);
    expect(walk(observation.tree)).toHaveLength(NODE_LIMIT);
    expect(observation.truncated).toBe(true);
  });

  it("does not count the refs of cut nodes as issued", () => {
    const { refs } = observe(items(NODE_LIMIT + 10));
    expect(refs.has(`3.e${NODE_LIMIT + 1}`)).toBe(false);
    expect(refs.has("3.e1")).toBe(true);
  });

  it("cuts to the character limit of the tree's JSON and marks it truncated", () => {
    const text = "x".repeat(AGENT_OBSERVATION_LIMITS.textChars);
    const snapshot = Array.from({ length: 200 }, (_, i) => ({ role: "paragraph", ref: `e${i + 1}`, text }));
    const { observation } = observe(snapshot);
    const json = JSON.stringify(observation.tree);
    const perNode = JSON.stringify(observation.tree[0]).length + 1;

    expect(observation.truncated).toBe(true);
    expect(walk(observation.tree).length).toBeLessThan(200);
    // Within the limit (* the brackets around the list may or may not be counted), and cut where the next node
    // would not have fitted, not earlier.
    expect(json.length).toBeLessThanOrEqual(totalChars + 10);
    expect(json.length + perNode - 3).toBeGreaterThan(totalChars);
  });

  it("does not mark a page truncated that fits both limits", () => {
    const snapshot = Array.from({ length: 60 }, (_, i) => ({ role: "paragraph", ref: `e${i + 1}`, text: "y".repeat(100) }));
    const { observation } = observe(snapshot);
    expect(walk(observation.tree)).toHaveLength(60);
    expect(observation.truncated).toBe(false);
  });
});

describe("what comes from the page itself", () => {
  it("copies path, title, status, problems and dialog from the meta", () => {
    const problems = { consoleErrors: 2, pageErrors: 1, failedRequests: 4 };
    const dialog = { type: "confirm", message: "Discard changes?" };
    const { observation } = observe([], { path: "/app/settings", title: "Settings", status: 404, problems, dialog });
    expect(observation.path).toBe("/app/settings");
    expect(observation.title).toBe("Settings");
    expect(observation.status).toBe(404);
    expect(observation.problems).toEqual(problems);
    expect(observation.dialog).toEqual(dialog);
  });

  it("copies the empty values too: no title, no status, no dialog", () => {
    const { observation } = observe([], { title: null, status: null, dialog: null });
    expect(observation.title).toBeNull();
    expect(observation.status).toBeNull();
    expect(observation.dialog).toBeNull();
    expect(observation.problems).toEqual({ consoleErrors: 0, pageErrors: 0, failedRequests: 0 });
  });
});

describe("odd input", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["a string", "just text"],
    ["a boolean", true],
  ])("shows an empty page for %s and does not throw", (_name, snapshot) => {
    const { observation, refs } = observe(snapshot);
    expect(observation.tree).toEqual([]);
    expect(refs.size).toBe(0);
    expect(observation.path).toBe(META.path);
  });

  it("ignores values that aren't nodes among the ones that are", () => {
    const { observation, refs } = observe([
      null,
      5,
      "a bare string",
      [],
      {},
      { name: "no role", ref: "e9" },
      { role: 7, name: "numeric role", ref: "e10" },
      { role: "button", name: "Real", ref: "e1" },
      undefined,
    ]);
    expect(observation.tree.map((node) => node.name)).toEqual(["Real"]);
    expect([...refs.keys()]).toEqual(["3.e1"]);
  });

  it("ignores children that aren't nodes or text, and a children field that isn't a list", () => {
    const { observation } = observe([
      { role: "main", ref: "e1", children: [null, 3, { nope: true }, { role: "button", name: "Kept", ref: "e2" }] },
      { role: "region", ref: "e3", children: "not a list" },
      { role: "region", ref: "e4", children: { role: "button", name: "Object, not a list", ref: "e5" } },
    ]);
    expect(find(observation, "button", "Kept")?.ref).toBe("3.e2");
    expect(find(observation, "region")).toBeDefined();
    expect(JSON.stringify(observation)).not.toContain("Object, not a list");
  });

  it("does not throw on fields of the wrong type", () => {
    expect(() =>
      observe([
        { role: "button", name: 42, ref: "e1", text: { nope: 1 }, url: 7, level: "two", checked: "yes", disabled: "no" },
        { role: "link", name: ["a"], ref: 99, url: {} },
        { role: "textbox", name: null, ref: "e3", text: 12345 },
        { role: "combobox", name: "Pick", ref: "e4", children: [null, { role: "option" }, { role: "option", name: 5 }, "text"] },
        { role: "generic", ref: "e5", children: [null, undefined, 1] },
      ]),
    ).not.toThrow();
  });

  it("copes with a very deep tree *", () => {
    let node: unknown = { role: "button", name: "Deep", ref: "e1" };
    for (let i = 0; i < 1000; i++) node = { role: "generic", ref: `g${i}`, children: [node] };
    const { observation } = observe([node]);
    expect(find(observation, "button", "Deep")?.ref).toBe("3.e1");
  });

  it("does not throw when hide returns something odd", () => {
    expect(() => observe([{ role: "button", name: "Save", ref: "e1" }], {}, () => "")).not.toThrow();
  });

  it("does not change the snapshot it is given", () => {
    const before = JSON.stringify(REALISTIC);
    observe(REALISTIC);
    expect(JSON.stringify(REALISTIC)).toBe(before);
  });
});
