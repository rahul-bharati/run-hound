// The Command primitive (DESIGN.md §2.5): one scrolling line with Copy. On copy the label becomes "Copied" and the
// prompt turns accent; an sr-only role=status elsewhere in the component speaks the next step. On failure the command
// is selected for the reader, the label becomes "Press Ctrl+C" and the status says so. The hint line below never
// changes, and nothing is stacked over it (the empty live region that covered "Other ways to start", E2).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import type { CopyState } from "./copy";
import { element, elements, html, textOf } from "./test-render";

const { Command } = await import("./command");
const { copyText, copyShortcut, COPIED_RESET_MS, runCopy, scheduleReset, selectionMatches } = await import("./copy");
const { primitiveLabels } = await import("./labels");

const command = "docker pull ghcr.io/rahul-bharati/run-hound && mkdir -p runs && docker run --rm ghcr.io/rahul-bharati/run-hound";
const next = "Paste it in a terminal, then open localhost:4000.";
const hint = createElement("span", null, "Then open localhost:4000. Docker or Podman. ", createElement("a", { href: "#start" }, "Other ways to start"));
const render = (initialState?: "idle" | "copied" | "failed") => html(createElement(Command, { command, next, hint, initialState }));

describe("copyText: the Clipboard API, and what happens when it isn't there", () => {
  test("success: writes exactly the command and reports copied", async () => {
    const written: string[] = [];
    const result = await copyText(command, { writeText: async (text: string) => void written.push(text) });
    assert.equal(result, "copied");
    assert.deepEqual(written, [command]);
  });

  test("failure: a rejected write (permission, an insecure page) reports failed", async () => {
    const result = await copyText(command, {
      writeText: async () => {
        throw new DOMException("Write permission denied.", "NotAllowedError");
      },
    });
    assert.equal(result, "failed");
  });

  test("failure: no Clipboard API at all reports failed", async () => {
    assert.equal(await copyText(command, undefined), "failed");
    assert.equal(await copyText(command, null), "failed");
  });

  test("the shortcut the failure names follows the reader's platform", () => {
    assert.equal(copyShortcut("Linux x86_64"), "Ctrl+C");
    assert.equal(copyShortcut("Win32"), "Ctrl+C");
    assert.equal(copyShortcut("MacIntel"), "⌘C");
    assert.equal(copyShortcut("iPhone"), "⌘C");
  });

  test("the copied state resets after 2 s (§4.3)", () => {
    assert.equal(COPIED_RESET_MS, 2000);
  });
});

describe("runCopy: what a click on Copy does (useCopy sets its state from the result)", () => {
  const counting = () => {
    const calls = { select: 0 };
    return { calls, select: () => void (calls.select += 1) };
  };

  test("success: writes the text, reports copied and never selects it", async () => {
    const written: string[] = [];
    const { calls, select } = counting();
    assert.equal(await runCopy(command, { writeText: async (text: string) => void written.push(text) }, select), "copied");
    assert.deepEqual(written, [command]);
    assert.equal(calls.select, 0);
  });

  test("a refused write: reports failed and selects the text for the reader exactly once", async () => {
    const { calls, select } = counting();
    const refusing = {
      writeText: async () => {
        throw new DOMException("Write permission denied.", "NotAllowedError");
      },
    };
    assert.equal(await runCopy(command, refusing, select), "failed");
    assert.equal(calls.select, 1);
  });

  test("no Clipboard API: reports failed and selects the text exactly once", async () => {
    const { calls, select } = counting();
    assert.equal(await runCopy(command, undefined, select), "failed");
    assert.equal(calls.select, 1);
  });

  test("the text is selected only after the write has failed, never before it is tried", async () => {
    const order: string[] = [];
    const refusing = {
      writeText: async () => {
        order.push("write");
        throw new Error("denied");
      },
    };
    await runCopy(command, refusing, () => void order.push("select"));
    assert.deepEqual(order, ["write", "select"]);
  });
});

describe("scheduleReset: Copied reads Copy again after 2 s", () => {
  test("idle at 2,000 ms, not before; a cancelled reset never fires", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const states: CopyState[] = [];
    // A copy each time: strict deepEqual narrows what it checks, and `states` grows below.
    const seen = () => [...states];
    scheduleReset((state) => void states.push(state));
    t.mock.timers.tick(COPIED_RESET_MS - 1);
    assert.deepEqual(seen(), []);
    t.mock.timers.tick(1);
    assert.deepEqual(seen(), ["idle"]);

    const cancel = scheduleReset((state) => void states.push(state));
    t.mock.timers.tick(COPIED_RESET_MS / 2);
    cancel();
    t.mock.timers.tick(COPIED_RESET_MS * 2);
    assert.deepEqual(seen(), ["idle"]);
  });
});

describe("selectionMatches: after a failure, only the reader's copy of this component's text counts as copied", () => {
  test("the selected text is the component's text (whitespace aside)", () => {
    assert.equal(selectionMatches(command, command), true);
    assert.equal(selectionMatches(`  ${command}\n`, command), true);
    const block = 'docker run --rm \\\n  -v "$PWD/runs:/repo/app/runs" image';
    assert.equal(selectionMatches(block.replace("\n  ", "\n    "), block), true);
  });

  test("a copy of anything else on the page doesn't", () => {
    assert.equal(selectionMatches("Then open localhost:4000.", command), false);
    assert.equal(selectionMatches(command.slice(0, 20), command), false);
    assert.equal(selectionMatches("", command), false);
    assert.equal(selectionMatches(undefined, command), false);
    assert.equal(selectionMatches(null, command), false);
    assert.equal(selectionMatches("", ""), false);
  });
});

describe("useCopy runs the tested steps (it can't render its effects in node --test)", () => {
  const source = readFileSync(new URL("./use-copy.ts", import.meta.url), "utf8");

  test("copy() goes through runCopy, the reset through scheduleReset, the reader's own copy through selectionMatches", () => {
    assert.match(source, /\brunCopy\(/);
    assert.match(source, /\bscheduleReset\(/);
    assert.match(source, /\bselectionMatches\(/);
    // No second copy path beside runCopy: the hook never calls the Clipboard API or a timer itself.
    assert.doesNotMatch(source, /writeText|copyText\(|setTimeout\(/);
  });
});

describe("Command, rendered", () => {
  test("idle: the $ prompt, the command in <code>, a keyboard-scrollable region named Run command, and Copy", () => {
    const markup = render();
    const region = element(markup, "div", 'role="region"');
    assert.ok(region, "no role=region");
    assert.match(region.attrs, /tabindex="0"/);
    assert.match(region.attrs, /aria-label="Run command"/);
    const code = element(region.inner, "code");
    assert.equal(textOf(code?.inner ?? ""), command);
    const prompt = element(region.inner, "span", 'aria-hidden="true"');
    assert.equal(textOf(prompt?.inner ?? ""), "$");
    const button = element(markup, "button");
    assert.match(button?.attrs ?? "", /type="button"/);
    assert.equal(textOf(button?.inner ?? ""), "Copy");
    assert.match(markup, /data-state="idle"/);
  });

  test("copied: the label says Copied, the prompt turns accent (data-state), the status speaks the next step", () => {
    const markup = render("copied");
    assert.equal(textOf(element(markup, "button")?.inner ?? ""), "Copied");
    assert.match(markup, /data-state="copied"/);
    assert.equal(textOf(element(markup, "span", 'role="status"')?.inner ?? ""), `Copied. ${next}`);
  });

  test("failed: the label says Press Ctrl+C and the status says the command is selected", () => {
    const markup = render("failed");
    assert.equal(textOf(element(markup, "button")?.inner ?? ""), "Press Ctrl+C");
    assert.match(markup, /data-state="failed"/);
    assert.equal(textOf(element(markup, "span", 'role="status"')?.inner ?? ""), "Couldn't copy: the command is selected, press Ctrl+C.");
  });

  test("idle: the status region is there and empty, so a later message is announced", () => {
    const status = element(render(), "span", 'role="status"');
    assert.ok(status);
    assert.match(status.attrs, /class="sr-only"/);
    assert.equal(textOf(status.inner), "");
  });

  test("the hint never changes and nothing is stacked over it: same text in every state, and the status is not inside it", () => {
    const hints = (["idle", "copied", "failed"] as const).map((state) => element(render(state), "p", 'class="command-hint"'));
    for (const found of hints) {
      assert.ok(found, "no hint line");
      assert.equal(textOf(found.inner), "Then open localhost:4000. Docker or Podman. Other ways to start");
      assert.doesNotMatch(found.inner, /role="status"|aria-live/);
    }
    // One live region in the component, and it is the sr-only status.
    const markup = render("copied");
    assert.equal(elements(markup, "span", 'role="status"').length, 1);
    assert.equal((markup.match(/aria-live=/g) ?? []).length, 0);
  });

  test("the command block is left out of the search index (§3.16: data-pagefind-ignore)", () => {
    const root = element(render(), "div", 'class="command"');
    assert.match(root?.attrs ?? "", /data-pagefind-ignore=""/);
  });

  test("labels come from one place (labels.ts)", () => {
    assert.equal(primitiveLabels.copy, "Copy");
    assert.equal(primitiveLabels.copied, "Copied");
    assert.equal(primitiveLabels.commandRegion, "Run command");
  });

  test("Copy is told apart from the page's other Copy buttons: described by the region's name, in an sr-only span (WCAG 2.4.6)", () => {
    const markup = render();
    const button = element(markup, "button")!;
    const describedBy = /aria-describedby="([^"]+)"/.exec(button.attrs)?.[1];
    assert.ok(describedBy, "Copy has no aria-describedby");
    const label = element(markup, "span", `id="${describedBy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
    assert.match(label?.attrs ?? "", /class="sr-only"/);
    assert.equal(textOf(label?.inner ?? ""), "Run command");
    // Not a live region: the status stays the component's only one.
    assert.doesNotMatch(label?.attrs ?? "", /role=|aria-live/);
    const again = html(createElement(Command, { command, label: "Run command again" }));
    assert.equal(textOf(element(again, "span", 'class="sr-only"')?.inner ?? ""), "Run command again");
  });

  test("a second Command on a page can take its own region name (landmark names stay unique)", () => {
    const markup = html(createElement(Command, { command, next, label: "Run command again" }));
    assert.match(element(markup, "div", 'role="region"')?.attrs ?? "", /aria-label="Run command again"/);
  });
});
