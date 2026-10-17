import { describe, expect, it, vi } from "vitest";
import { contextMenuTemplate, isCopyableLink, type ContextMenuInput } from "../src/context-menu.js";

const none = { canCut: false, canCopy: false, canPaste: false, canSelectAll: false };
const params = (over: Partial<ContextMenuInput> = {}): ContextMenuInput => ({ isEditable: false, selectionText: "", linkURL: "", editFlags: none, ...over });
const summary = (items: Electron.MenuItemConstructorOptions[]): string[] => items.map((item) => (item.type === "separator" ? "-" : (item.role ?? item.label ?? "?")));

describe("contextMenuTemplate", () => {
  const actions = { copyText: vi.fn() };

  it("offers nothing on a page's plain text, so no menu pops up", () => {
    expect(contextMenuTemplate(params(), actions)).toEqual([]);
    expect(contextMenuTemplate(params({ selectionText: "   " }), actions)).toEqual([]);
  });

  it("an editable field gets Cut, Copy, Paste and Select All, each enabled by the renderer's edit flags", () => {
    const items = contextMenuTemplate(params({ isEditable: true, editFlags: { canCut: true, canCopy: false, canPaste: true, canSelectAll: true } }), actions);
    expect(summary(items)).toEqual(["cut", "copy", "paste", "-", "selectAll"]);
    expect(items.filter((item) => item.type !== "separator").map((item) => [item.role, item.enabled])).toEqual([["cut", true], ["copy", false], ["paste", true], ["selectAll", true]]);
  });

  it("an empty field: only Paste and Select All can be on", () => {
    const items = contextMenuTemplate(params({ isEditable: true, editFlags: { ...none, canPaste: true } }), actions);
    expect(items.filter((item) => item.type !== "separator").map((item) => [item.role, item.enabled])).toEqual([["cut", false], ["copy", false], ["paste", true], ["selectAll", false]]);
  });

  it("selected text outside a field gets Copy alone", () => {
    const items = contextMenuTemplate(params({ selectionText: "hello", editFlags: { ...none, canCopy: true } }), actions);
    expect(summary(items)).toEqual(["copy"]);
    expect(items[0]?.enabled).toBe(true);
  });

  it("a web link gets Copy Link Address, which copies the address as given", () => {
    const copyText = vi.fn();
    const items = contextMenuTemplate(params({ linkURL: "https://example.com/a?b=1" }), { copyText });
    expect(summary(items)).toEqual(["Copy Link Address"]);
    items[0]?.click?.({} as never, undefined, {} as never);
    expect(copyText).toHaveBeenCalledExactlyOnceWith("https://example.com/a?b=1");
  });

  it("a link with selected text gets Copy, a separator and Copy Link Address", () => {
    const items = contextMenuTemplate(params({ selectionText: "docs", linkURL: "http://127.0.0.1:1234/x", editFlags: { ...none, canCopy: true } }), actions);
    expect(summary(items)).toEqual(["copy", "-", "Copy Link Address"]);
  });

  it.each(["javascript:alert(1)", "file:///etc/passwd", "mailto:a@b.c", "data:text/html,hi", "x-run-hound-check:hello", "/relative", "not a url", ""])(
    "never offers to copy %j",
    (linkURL) => {
      expect(isCopyableLink(linkURL)).toBe(false);
      expect(contextMenuTemplate(params({ linkURL }), actions)).toEqual([]);
    },
  );

  it("adds Inspect Element only when the caller gives an inspect action (running from source)", () => {
    const inspect = vi.fn();
    const dev = contextMenuTemplate(params({ selectionText: "x", editFlags: { ...none, canCopy: true } }), { copyText: vi.fn(), inspect });
    expect(summary(dev)).toEqual(["copy", "-", "Inspect Element"]);
    dev[2]?.click?.({} as never, undefined, {} as never);
    expect(inspect).toHaveBeenCalledOnce();
    expect(summary(contextMenuTemplate(params(), { copyText: vi.fn(), inspect }))).toEqual(["Inspect Element"]);
    for (const text of [params(), params({ isEditable: true }), params({ linkURL: "https://example.com/" })]) {
      expect(JSON.stringify(contextMenuTemplate(text, actions))).not.toContain("Inspect");
    }
  });

  it("uses only roles that exist in Electron's menu API and no developer or navigation roles", () => {
    const all = contextMenuTemplate(params({ isEditable: true, selectionText: "x", linkURL: "https://example.com/", editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } }), actions);
    const roles = all.map((item) => item.role).filter(Boolean);
    expect(roles).toEqual(["cut", "copy", "paste", "selectAll"]);
  });
});
