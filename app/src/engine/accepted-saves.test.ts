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

/**
 * CHK-5: an app that also POSTs to its own origin to read (GraphQL queries, Apollo's default) or to report events
 * (a same-origin analytics proxy) created no record with those requests. Only writes that carry the run's test values,
 * page posts and writes with no body at all count.
 */
describe("isAcceptedSave: reads and events sent as POST (CHK-5)", () => {
  const gql = (query: string, variables: Record<string, unknown> = {}) => JSON.stringify({ query, variables });

  it("does not count a GraphQL query, even one that carries a test value in its variables", () => {
    expect(isAcceptedSave(save({ url: "http://localhost:5173/graphql", status: 200, postData: gql("query { entries { id name } }") }), TARGET, TOKEN)).toBe(false);
    expect(isAcceptedSave(save({ url: "http://localhost:5173/graphql", status: 200, postData: gql("query Find($q: String) { entries(q: $q) { id } }", { q: `Name ${TOKEN}keep` }) }), TARGET, TOKEN)).toBe(false);
    // A batch of queries is a read too.
    expect(isAcceptedSave(save({ url: "http://localhost:5173/graphql", status: 200, postData: `[${gql("{ me { id } }")},${gql("query { entries { id } }")}]` }), TARGET, TOKEN)).toBe(false);
  });

  it("counts a GraphQL mutation that carries the test values", () => {
    const mutation = gql("mutation Sign($name: String!) { sign(name: $name) { id } }", { name: `Name ${TOKEN}keep` });
    expect(isAcceptedSave(save({ url: "http://localhost:5173/graphql", status: 200, postData: mutation }), TARGET, TOKEN)).toBe(true);
  });

  it("does not count a same-origin write without the test values in its body (an analytics proxy, a refetch)", () => {
    expect(isAcceptedSave(save({ url: "http://localhost:5173/ingest", postData: '{"event":"$pageview"}' }), TARGET, TOKEN)).toBe(false);
    expect(isAcceptedSave(save({ url: "http://localhost:5173/rpc/listEntries", status: 200, postData: '{"page":1}' }), TARGET, TOKEN)).toBe(false);
  });

  it("still counts a page post and a write with no body (a button that creates a draft)", () => {
    expect(isAcceptedSave(save({ resourceType: "document", status: 303, postData: "subscribe=on" }), TARGET, TOKEN)).toBe(true);
    expect(isAcceptedSave(save({ url: "http://localhost:5173/api/drafts", postData: null }), TARGET, TOKEN)).toBe(true);
    expect(isAcceptedSave(save({ url: "http://localhost:5173/api/drafts", postData: "" }), TARGET, TOKEN)).toBe(true);
  });
});
