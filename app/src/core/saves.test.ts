/**
 * One definition of "the form's save request" for every check and the engine (docs/v0-spec.md, "Tester release":
 * unfamiliar apps). A classic form post that redirects, a same-origin JSON API and an API on another origin are all
 * save requests; analytics beacons and preflights are not.
 */
import { describe, expect, it } from "vitest";
import { carriesTestValues, isAcceptedStatus, isLocalOrigin, isPagePost, isSameOrigin, isSaveRequest, isWrite, tokenKey } from "./saves.js";

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
