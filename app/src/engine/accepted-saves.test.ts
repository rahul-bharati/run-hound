/**
 * report.testRecordsCreated counts the save requests the app accepted (docs/v0-spec.md, "Tester release": test data
 * is disclosed, not deleted). isAcceptedSave decides what counts.
 */
import { describe, expect, it } from "vitest";
import { isAcceptedSave } from "./context.js";

const TARGET = "http://localhost:5173/book";
const TOKEN = "ab12cd34";
const save = (over: Partial<Parameters<typeof isAcceptedSave>[0]> = {}) => ({
  method: "POST",
  resourceType: "fetch",
  url: "http://localhost:5173/api/bookings",
  status: 201,
  postData: `{"petName":"Name ${TOKEN}keep"}`,
  ...over,
});

describe("isAcceptedSave", () => {
  it("counts a same-origin POST, PUT or PATCH the app answered 2xx, and a form post answered with a redirect", () => {
    expect(isAcceptedSave(save(), TARGET, TOKEN)).toBe(true);
    expect(isAcceptedSave(save({ method: "PUT", status: 200 }), TARGET, TOKEN)).toBe(true);
    expect(isAcceptedSave(save({ method: "PATCH", resourceType: "xhr", status: 204 }), TARGET, TOKEN)).toBe(true);
    expect(isAcceptedSave(save({ resourceType: "document", status: 303, postData: "name=x" }), TARGET, TOKEN)).toBe(true);
  });

  it("does not count reads, rejected or failed saves, or other resource types", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) expect(isAcceptedSave(save({ method }), TARGET, TOKEN), method).toBe(false);
    for (const status of [400, 422, 500, null]) expect(isAcceptedSave(save({ status }), TARGET, TOKEN), String(status)).toBe(false);
    expect(isAcceptedSave(save({ resourceType: "ping" }), TARGET, TOKEN)).toBe(false);
    expect(isAcceptedSave(save({ resourceType: "image" }), TARGET, TOKEN)).toBe(false);
  });

  it("does not count a response a check simulated (route.fulfill)", () => {
    expect(isAcceptedSave(save({ simulated: true }), TARGET, TOKEN)).toBe(false);
  });

  it("counts an API on another origin only when the body carries the run's test values", () => {
    const api = "http://localhost:5174/api/rsvp";
    expect(isAcceptedSave(save({ url: api }), TARGET, TOKEN)).toBe(true);
    expect(isAcceptedSave(save({ url: api, postData: `{"email":"owner.${TOKEN.toUpperCase()}@example.test"}` }), TARGET, TOKEN)).toBe(true);
    // An analytics beacon without the test values in its body is not a record in the app.
    expect(isAcceptedSave(save({ url: "http://localhost:9999/collect", postData: '{"event":"booking_created"}' }), TARGET, TOKEN)).toBe(false);
    expect(isAcceptedSave(save({ url: "http://localhost:9999/collect", postData: null }), TARGET, TOKEN)).toBe(false);
  });
});
