// The CodeBlock primitive (DESIGN.md §2.5): a multi-line terminal block whose data is { commands, output?, comment? }.
// Copy copies the commands only, never prompts, comments or output; real output lines render dim. The prompts are
// drawn by CSS, so even a reader's own selection of the commands (what the failure state selects) holds no "$ ".
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { element, elements, html, textOf } from "./test-render";

const { CodeBlock } = await import("./code-block");
/** An id as a regex source (React's useId ids hold characters such as «» or _ that are safe, and : that isn't special). */
const escapeId = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const { commandsText, copyText } = await import("./copy");

const block = {
  label: "Start Run Hound",
  comment: "reports land in ./runs",
  commands: [
    "docker pull ghcr.io/rahul-bharati/run-hound",
    "mkdir -p runs",
    'docker run --rm --init -p 127.0.0.1:4000:4000 \\\n  -v "$PWD/runs:/repo/app/runs" ghcr.io/rahul-bharati/run-hound',
  ],
  output: ["Run Hound UI: open http://localhost:4000 in your browser"],
};

describe("CodeBlock: what Copy copies", () => {
  test("the commands, one per line, and nothing else", () => {
    const text = commandsText(block);
    assert.equal(text, block.commands.join("\n"));
    assert.doesNotMatch(text, /^\$ /m);
    assert.doesNotMatch(text, /reports land in/);
    assert.doesNotMatch(text, /Run Hound UI/);
  });

  test("copyText gets exactly that text", async () => {
    const written: string[] = [];
    assert.equal(await copyText(commandsText(block), { writeText: async (t: string) => void written.push(t) }), "copied");
    assert.deepEqual(written, [block.commands.join("\n")]);
  });

  test("a block without output or comment copies its commands", () => {
    assert.equal(commandsText({ commands: ["pnpm lab"] }), "pnpm lab");
  });
});

describe("CodeBlock, rendered", () => {
  const markup = html(createElement(CodeBlock, block));

  test("the commands sit in one element whose text is exactly what Copy copies (the failure state selects it)", () => {
    const commands = element(markup, "span", "data-commands");
    assert.ok(commands, "no [data-commands] element");
    assert.equal(textOf(commands.inner), block.commands.join("\n"));
  });

  test("each command is its own line, with the prompt drawn by CSS (class code-cmd), never as text", () => {
    const lines = elements(markup, "span", 'class="code-cmd"');
    assert.equal(lines.length, block.commands.length);
    assert.doesNotMatch(textOf(markup), /\$ docker/);
  });

  test("the comment and the output are outside the commands; output lines are dim", () => {
    const commands = element(markup, "span", "data-commands")!;
    assert.doesNotMatch(commands.inner, /code-comment|code-out/);
    const comment = element(markup, "span", 'class="code-comment"');
    assert.equal(textOf(comment?.inner ?? ""), "# reports land in ./runs");
    const output = elements(markup, "span", 'class="code-out"');
    assert.deepEqual(output.map((o) => textOf(o.inner)), block.output);
  });

  test("the block scrolls sideways from the keyboard: a focusable region named by its label, with Copy and a status", () => {
    const pre = element(markup, "pre");
    assert.match(pre?.attrs ?? "", /tabindex="0"/);
    assert.match(pre?.attrs ?? "", /role="region"/);
    assert.match(pre?.attrs ?? "", /aria-label="Start Run Hound"/);
    assert.equal(textOf(element(markup, "button")?.inner ?? ""), "Copy");
    assert.equal(textOf(element(markup, "span", 'role="status"')?.inner ?? "x"), "");
  });

  test("Copy is told apart from the page's other Copy buttons: described by the block's label (WCAG 2.4.6)", () => {
    const button = element(markup, "button")!;
    const describedBy = /aria-describedby="([^"]+)"/.exec(button.attrs)?.[1];
    assert.ok(describedBy, "Copy has no aria-describedby");
    const label = element(markup, "span", `id="${escapeId(describedBy)}"`);
    assert.match(label?.attrs ?? "", /class="code-block-label"/);
    assert.equal(textOf(label?.inner ?? ""), "Start Run Hound");
    // Two blocks on one page get two ids.
    const two = html(createElement("div", null, createElement(CodeBlock, block), createElement(CodeBlock, { ...block, label: "Again" })));
    const ids = elements(two, "button").map((b) => /aria-describedby="([^"]+)"/.exec(b.attrs)?.[1]);
    assert.equal(new Set(ids).size, 2);
  });

  test("the block is left out of the search index (§3.16: data-pagefind-ignore on command blocks)", () => {
    const root = element(markup, "div", 'class="code-block"');
    assert.match(root?.attrs ?? "", /data-pagefind-ignore=""/);
  });

  test("copied and failed states", () => {
    const copied = html(createElement(CodeBlock, { ...block, initialState: "copied" }));
    assert.equal(textOf(element(copied, "button")?.inner ?? ""), "Copied");
    assert.equal(textOf(element(copied, "span", 'role="status"')?.inner ?? ""), "Copied.");
    const failed = html(createElement(CodeBlock, { ...block, initialState: "failed" }));
    assert.equal(textOf(element(failed, "button")?.inner ?? ""), "Press Ctrl+C");
    assert.equal(textOf(element(failed, "span", 'role="status"')?.inner ?? ""), "Couldn't copy: the commands are selected, press Ctrl+C.");
  });
});
