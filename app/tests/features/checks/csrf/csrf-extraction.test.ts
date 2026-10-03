// csrf extraction regression: forgedBodies picks the top-level field that carries the marker in nested JSON, and replaySpec names that field.
import { describe, expect, it } from "vitest";
import { forgedBodies } from "../../../../src/checks/csrf/forged-bodies.js";
import { replaySpec } from "../../../../src/checks/csrf/finding.js";
import type { CapturedRequest } from "../../../../src/checks/lib/record-state.js";

function captured(method: string, url: string, postData: string | null): CapturedRequest {
  return {
    method,
    url,
    postData,
    resourceType: "fetch",
    status: null,
    failure: null,
    responseBody: null,
  };
}

describe("forgedBodies: nested JSON marker is reported on the top-level field", () => {
  it("marks the top-level field when the run token lives at a nested path (regression for walk(x,k) vs walk(x,top))", () => {
    // The form sends { task: { title: "...cf7e57a1..." } }: the marker-bearing string is at task.title, but the
    // orchestrator re-reads the record by top-level fields, so the recorded marker field must be the top-level "task".
    const save = captured("POST", "http://localhost/api/tasks", JSON.stringify({ task: { title: "Run-HH-MMcf7e57a1" }, other: "stays" }));
    const bodies = forgedBodies(save, "cf7e57a1", new Set(), new Set(), new Set());
    expect(bodies).not.toBeNull();
    expect(bodies!.kind).toBe("json");
    expect(bodies!.marked).toBe("task");
    const json = JSON.parse(bodies!.json!) as { task: { title: string }; other: string };
    expect(json.task.title).toContain("cf7e57a1csrf");
    expect(json.other).toBe("stays");
  });

  it("marks the array element's index when the marker is inside a top-level array", () => {
    const save = captured("POST", "http://localhost/api/tasks", JSON.stringify({ items: ["cf7e57a1", "stays"], note: "x" }));
    const bodies = forgedBodies(save, "cf7e57a1", new Set(), new Set(), new Set());
    expect(bodies).not.toBeNull();
    expect(bodies!.marked).toBe("items");
  });
});

describe("replaySpec: the exported spec names the marked top-level field, not the nested one", () => {
  it("contains FORGED_FIELD set to the top-level field that holds the marker in a nested JSON save", () => {
    const spec = replaySpec({
      target: "http://localhost:3000",
      save: "http://localhost:3000/api/tasks",
      record: "http://localhost:3000/api/tasks",
      fields: ["task", "other"],
      marked: "task",
      encoding: "text",
      attackerOrigin: "http://127.0.0.1:8080",
    });
    expect(spec).toContain('const FORGED_FIELD = "task"');
    expect(spec).toContain('const FIELDS = ["task","other"]');
  });
});