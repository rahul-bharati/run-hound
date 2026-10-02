/**
 * One definition of "the form's save request" for every check and the engine (docs/v0-spec.md, "Tester release":
 * unfamiliar apps). A classic form post that redirects, a same-origin JSON API and an API on another origin are all
 * save requests; analytics beacons and preflights are not.
 */
import { describe, expect, it } from "vitest";
import { carriesTestValues, isAcceptedStatus, isGraphQlDocument, isGraphQlRead, isLocalOrigin, isPagePost, isSameOrigin, isSaveRequest, isWrite, tokenKey } from "./saves.js";

const TARGET = "http://localhost:5173/signup";
const TOKEN = "ab12cd34";
const req = (over: Partial<Parameters<typeof isSaveRequest>[0]> = {}) => ({
  method: "POST",
  resourceType: "fetch",
  url: "http://localhost:5173/api/signups",
  postData: '{"name":"Name ab12cd34keep"}',
  ...over,
});

describe("isSaveRequest", () => {
  it("counts writes to the target's own origin, by fetch, XHR or a classic page post", () => {
    expect(isSaveRequest(req(), TARGET, TOKEN)).toBe(true);
    expect(isSaveRequest(req({ resourceType: "xhr", method: "PUT" }), TARGET, TOKEN)).toBe(true);
    expect(isSaveRequest(req({ resourceType: "document", url: "http://localhost:5173/signup", postData: "name=x" }), TARGET, TOKEN)).toBe(true);
    // Without a token only the target's own origin counts.
    expect(isSaveRequest(req({ postData: null }), TARGET)).toBe(true);
  });

  it("counts a write to an API on another origin when its body carries the run's test values", () => {
    const api = "http://localhost:5174/api/rsvps";
    expect(isSaveRequest(req({ url: api }), TARGET, TOKEN)).toBe(true);
    // Upper-case or URL-encoded, the token is still found.
    expect(isSaveRequest(req({ url: api, postData: "email=owner.AB12CD34%40example.test" }), TARGET, TOKEN)).toBe(true);
    expect(isSaveRequest(req({ url: api }), TARGET)).toBe(false);
  });

  it("never counts reads, preflights, beacons without test values or other resource types", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) expect(isSaveRequest(req({ method }), TARGET, TOKEN), method).toBe(false);
    expect(isSaveRequest(req({ url: "http://localhost:9999/collect", postData: '{"event":"booking_created"}' }), TARGET, TOKEN)).toBe(false);
    expect(isSaveRequest(req({ resourceType: "ping" }), TARGET, TOKEN)).toBe(false);
    expect(isSaveRequest(req({ resourceType: "image" }), TARGET, TOKEN)).toBe(false);
  });
});

describe("isAcceptedStatus", () => {
  it("accepts 2xx and redirects (a classic form post answers 303 See Other), nothing else", () => {
    for (const status of [200, 201, 204, 302, 303]) expect(isAcceptedStatus(status), String(status)).toBe(true);
    for (const status of [null, undefined, 0, 199, 400, 401, 422, 500]) expect(isAcceptedStatus(status), String(status)).toBe(false);
  });
});

describe("helpers", () => {
  it("tokenKey keeps lowercase letters and digits only, as every test value does", () => {
    expect(tokenKey("Ab-12_CD")).toBe("ab12cd");
  });

  it("carriesTestValues finds the token raw, lowercased or URL-encoded, and never in an empty body", () => {
    expect(carriesTestValues('{"n":"x AB12CD34"}', TOKEN)).toBe(true);
    expect(carriesTestValues("a=Rh+ab12cd34", TOKEN)).toBe(true);
    expect(carriesTestValues(null, TOKEN)).toBe(false);
    expect(carriesTestValues("anything", "")).toBe(false);
  });

  it("isWrite, isPagePost and isSameOrigin", () => {
    expect(isWrite({ method: "patch", resourceType: "fetch" })).toBe(true);
    expect(isWrite({ method: "POST", resourceType: "script" })).toBe(false);
    expect(isPagePost({ resourceType: "document" })).toBe(true);
    expect(isPagePost({ resourceType: "fetch" })).toBe(false);
    expect(isSameOrigin("http://localhost:5173/a", TARGET)).toBe(true);
    expect(isSameOrigin("http://localhost:5174/a", TARGET)).toBe(false);
    expect(isSameOrigin("data:text/plain,x", "data:text/plain,y")).toBe(false);
  });

  it("isLocalOrigin: the target's host, loopback and private-network addresses, never the internet", () => {
    for (const url of ["http://localhost:1/x", "http://api.localhost/x", "http://127.0.0.1:9/x", "http://[::1]:9/", "http://10.0.0.5/", "http://192.168.1.2/", "http://172.20.0.1/", "http://[fd00::1]/"]) {
      expect(isLocalOrigin(url, TARGET), url).toBe(true);
    }
    expect(isLocalOrigin("http://myapp.test:5174/api", "http://myapp.test:5173/")).toBe(true);
    for (const url of ["https://api.example.com/x", "http://8.8.8.8/", "http://172.32.0.1/", "not a url"]) expect(isLocalOrigin(url, TARGET), url).toBe(false);
  });
});

/**
 * A GraphQL read sent as a POST (0.6.0 close-out round 2): every operation of the body holds nothing but GraphQL request
 * keys (query, variables, operationName, extensions), and its query text, with comments left out, starts a GraphQL
 * document that holds no mutation. A REST body with a "query" field (a saved search, a default-search setting) is a
 * write, never a read: the existing-record hold judges it, and the test-record count counts it.
 */
describe("isGraphQlRead: only a GraphQL request body whose query is a GraphQL document with no mutation", () => {
  const body = (o: unknown) => JSON.stringify(o);

  it.each([
    ["an anonymous query", { query: "{ tasks { id title } }" }],
    ["a named query with variables (Apollo's POST)", { operationName: "Tasks", query: "query Tasks($first: Int) { tasks(first: $first) { id } }", variables: { first: 10 } }],
    ["a query with a directive and extensions", { query: "query Me @cached { me { id } }", extensions: { persistedQuery: { version: 1, sha256Hash: "ab12" } } }],
    ["a query led by a comment", { query: "# the page's own read\nquery { me { id } }" }],
    ["fragments first", { query: "fragment T on Task { id title }\nquery { tasks { ...T } }" }],
    ["a subscription", { query: "subscription OnTask { taskAdded { id } }" }],
  ])("is a read: %s", (_name, op) => {
    expect(isGraphQlRead(body(op))).toBe(true);
  });

  it("is a read: a batch of queries", () => {
    expect(isGraphQlRead(body([{ query: "{ me { id } }" }, { query: "query { tasks { id } }", variables: {} }]))).toBe(true);
  });

  it.each([
    ["a saved search's {name, query}", { name: "Name c3d4e5f6wab", query: "Search c3d4e5f6wab" }],
    ["a default-search setting {query}", { query: "search c3d4e5f6xsite" }],
    ["a saved search's edit by id", { id: "s1", name: "Open", query: "status:open" }],
    ["a GraphQL query beside a key GraphQL doesn't send", { query: "{ me { id } }", name: "x" }],
    ["a JSON filter kept as text", { query: '{"status":"open"}' }],
    ["a word that only starts like a keyword", { query: "queryString { x }" }],
    ["a query with no selection set", { query: "query Tasks" }],
    ["a mutation", { query: "mutation { updateTask(id: 1) { id } }" }],
    ["a document with a query and a mutation", { query: "query A { a } mutation B { b }", operationName: "A" }],
    ["a persisted query with no text", { operationName: "Tasks", variables: {}, extensions: { persistedQuery: { version: 1, sha256Hash: "ab12" } } }],
  ])("is not a read: %s", (_name, op) => {
    expect(isGraphQlRead(body(op))).toBe(false);
  });

  it("is not a read: a batch with one REST body in it, an empty batch, a form body, no body", () => {
    expect(isGraphQlRead(body([{ query: "{ me { id } }" }, { query: "status:open", name: "x" }]))).toBe(false);
    expect(isGraphQlRead("[]")).toBe(false);
    expect(isGraphQlRead("query=%7B+me+%7B+id+%7D+%7D")).toBe(false);
    expect(isGraphQlRead(null)).toBe(false);
  });

  it("isGraphQlDocument: a selection set, or query, subscription or fragment before one", () => {
    for (const text of ["{ a }", "  query { a }", "query Q($x: [ID!] = [\"a\"]) { a(x: $x) }", "fragment F on T { id } query { ...F }", "#c\n{ a }"]) {
      expect(isGraphQlDocument(text), text).toBe(true);
    }
    for (const text of ["", "status:open", '{"a":1}', "{ }", "query", "queries { a }", "Query { a }"]) expect(isGraphQlDocument(text), text).toBe(false);
  });
});
