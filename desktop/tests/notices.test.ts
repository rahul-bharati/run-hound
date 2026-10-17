import { describe, expect, it } from "vitest";
import { importFailedNotice, importedNotice } from "../src/import-notice.js";
import { createNoticeQueue } from "../src/notices.js";

describe("the notice queue", () => {
  it("starts empty", () => {
    expect(createNoticeQueue().take()).toEqual([]);
  });

  it("hands over every notice, oldest first, and only once", () => {
    const queue = createNoticeQueue();
    queue.add({ type: "info", message: "first" });
    queue.add({ type: "warning", message: "second", detail: "why" });
    expect(queue.take()).toEqual([{ type: "info", message: "first" }, { type: "warning", message: "second", detail: "why" }]);
    expect(queue.take()).toEqual([]);
  });

  it("keeps notices added after a take for the next one", () => {
    const queue = createNoticeQueue();
    queue.add({ type: "info", message: "a" });
    queue.take();
    queue.add({ type: "info", message: "b" });
    expect(queue.take()).toEqual([{ type: "info", message: "b" }]);
  });

  it("carries the settings import's two messages as they are worded for the banner", () => {
    const queue = createNoticeQueue();
    queue.add(importedNotice({ from: "/home/me/.config/run-hound", problem: null }));
    queue.add(importFailedNotice("/home/me/.config/run-hound", new Error("EACCES: permission denied")));
    const [imported, failed] = queue.take();
    expect(imported).toEqual({ type: "info", message: "Imported your settings from /home/me/.config/run-hound." });
    expect(failed?.type).toBe("warning");
    expect(failed?.detail).toBe("EACCES: permission denied");
  });
});
