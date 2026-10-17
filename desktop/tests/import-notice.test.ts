import { describe, expect, it } from "vitest";
import { importFailedNotice, importedNotice } from "../src/import-notice.js";

describe("importedNotice", () => {
  it("says where the settings came from", () => {
    expect(importedNotice({ from: "/home/qa/.config/run-hound", problem: null })).toEqual({
      type: "info",
      message: "Imported your settings from /home/qa/.config/run-hound.",
    });
  });

  it("adds that saved keys need entering again when they could not be imported", () => {
    const notice = importedNotice({ from: "/home/qa/.config/run-hound", problem: "Saved keys and passwords can't be unlocked on this machine." });
    expect(notice.type).toBe("info");
    expect(notice.message).toBe(
      "Imported your settings from /home/qa/.config/run-hound. Some of your saved keys couldn't be imported, so enter any that are missing again in Settings.",
    );
    // The problem text speaks of the command line; it is for the log, not for this message.
    expect(notice.message).not.toContain("can't be unlocked");
  });
});

describe("importFailedNotice", () => {
  it("names the folder, says nothing was changed there, and what to do", () => {
    const notice = importFailedNotice("/home/qa/.config/run-hound", Object.assign(new Error("EACCES: permission denied, open 'ai.json'"), { code: "EACCES" }));
    expect(notice.type).toBe("warning");
    expect(notice.message).toContain("/home/qa/.config/run-hound");
    expect(notice.message).toContain("unchanged");
    expect(notice.message).toContain("enter your settings again");
    expect(notice.detail).toContain("EACCES");
  });
});
