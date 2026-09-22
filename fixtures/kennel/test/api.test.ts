import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startKennel, V0_BUGS, type Kennel } from "./kennel.js";
import { listBookings, postBooking, STACK_RE, validBooking } from "./form.js";

describe("Kennel API contract (clean mode)", () => {
  let kennel: Kennel;
  beforeAll(async () => {
    kennel = await startKennel("none");
  });
  afterAll(async () => {
    await kennel?.stop();
  });
  beforeEach(async () => {
    await kennel.reset();
  });

  it("prints 'kennel listening' once ready", () => {
    expect(kennel.output()).toContain("kennel listening");
  });

  it("GET /api/__config lists no bugs and the analytics origin", async () => {
    const res = await fetch(`${kennel.url}/api/__config`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { bugs: string[]; analyticsUrl: string };
    expect(body.bugs).toEqual([]);
    expect(new URL(body.analyticsUrl).port).toBe(new URL(kennel.analyticsUrl).port);
    expect(new URL(body.analyticsUrl).origin).not.toBe(new URL(kennel.url).origin);
  });

  it("GET /api/availability says available", async () => {
    const res = await fetch(`${kennel.url}/api/availability`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true });
  });

  it("POST /api/bookings creates a booking and GET lists it; unknown keys are not stored", async () => {
    const input = validBooking();
    const created = await postBooking(kennel, { ...input, password: "hunter2-FAKE", confirmPassword: "hunter2-FAKE" });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject(input);
    expect(typeof created.json.id).toBe("string");
    expect(created.text).not.toContain("hunter2-FAKE");

    const list = await listBookings(kennel);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ ...input, id: created.json.id });
    expect(JSON.stringify(list)).not.toContain("hunter2-FAKE");
  });

  it("optional phone and instructions default to empty strings", async () => {
    const { phone: _p, instructions: _i, ...required } = validBooking();
    const created = await postBooking(kennel, required);
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ ...required, phone: "", instructions: "" });
  });

  it("POST /api/__reset clears all bookings", async () => {
    await postBooking(kennel, validBooking());
    expect(await listBookings(kennel)).toHaveLength(1);
    const res = await fetch(`${kennel.url}/api/__reset`, { method: "POST" });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(await listBookings(kennel)).toEqual([]);
  });

  it("DELETE /api/bookings/:id removes a booking; unknown id is 404", async () => {
    const created = await postBooking(kennel, validBooking());
    const del = await fetch(`${kennel.url}/api/bookings/${created.json.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect(await listBookings(kennel)).toEqual([]);
    const missing = await fetch(`${kennel.url}/api/bookings/does-not-exist`, { method: "DELETE" });
    expect(missing.status).toBe(404);
  });

  describe("server-side validation returns 400 { errors } and stores nothing", () => {
    const cases: [string, Record<string, unknown>, string[]][] = [
      ["empty body", {}, ["petName", "petType", "startDate", "endDate", "ownerEmail"]],
      ["blank pet name", { petName: "   " }, ["petName"]],
      ["pet name over 50 chars", { petName: "x".repeat(51) }, ["petName"]],
      ["unknown pet type", { petType: "fish" }, ["petType"]],
      ["invalid start date", { startDate: "2030-13-45" }, ["startDate"]],
      ["missing end date", { endDate: "" }, ["endDate"]],
      ["end before start", { startDate: "2030-05-03", endDate: "2030-05-01" }, ["endDate"]],
      ["invalid email", { ownerEmail: "not-an-email" }, ["ownerEmail"]],
      ["phone too long", { phone: "1".repeat(31) }, ["phone"]],
      ["instructions too long", { instructions: "y".repeat(1001) }, ["instructions"]],
    ];
    for (const [name, patch, fields] of cases) {
      it(name, async () => {
        const body = name === "empty body" ? {} : { ...validBooking(), ...patch };
        const res = await postBooking(kennel, body);
        expect(res.status).toBe(400);
        expect(res.json).toBeTypeOf("object");
        expect(res.json.errors).toBeTypeOf("object");
        for (const field of fields) expect(res.json.errors[field], field).toBeTypeOf("string");
        expect(res.text).not.toMatch(STACK_RE);
        expect(await listBookings(kennel)).toEqual([]);
      });
    }

    it("end date equal to start date is accepted", async () => {
      const res = await postBooking(kennel, validBooking({ startDate: "2030-05-01", endDate: "2030-05-01" }));
      expect(res.status).toBe(201);
    });

    it("pet name of exactly 50 chars is accepted", async () => {
      const res = await postBooking(kennel, validBooking({ petName: "x".repeat(50) }));
      expect(res.status).toBe(201);
    });

    it("malformed JSON is a 400 with errors.body and no stack trace", async () => {
      const res = await postBooking(kennel, "{ not json");
      expect(res.status).toBe(400);
      expect(res.json.errors.body).toBeTypeOf("string");
      expect(res.text).not.toMatch(STACK_RE);
    });
  });

  it('pet name "Crash" returns 500 { error } without a stack trace and stores nothing', async () => {
    const res = await postBooking(kennel, validBooking({ petName: "Crash" }));
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: "Something went wrong" });
    expect(res.text).not.toMatch(STACK_RE);
    expect(await listBookings(kennel)).toEqual([]);
  });

  it("unknown API routes are 404 JSON without stack traces", async () => {
    const res = await fetch(`${kennel.url}/api/nope`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Not found" });
    expect(text).not.toMatch(STACK_RE);
  });

  it("clean mode never returns stack traces for hostile input", async () => {
    const bodies: string[] = [
      "{ not json",
      "null",
      "[]",
      '"string"',
      JSON.stringify({ petName: { $gt: "" }, petType: ["dog"], startDate: 123, endDate: null, ownerEmail: false }),
      JSON.stringify({ ...validBooking(), petName: "x".repeat(100_000) }),
      JSON.stringify({ ...validBooking(), petName: "Crash" }),
    ];
    for (const body of bodies) {
      const res = await postBooking(kennel, body);
      expect(res.status, body.slice(0, 40)).toBeGreaterThanOrEqual(400);
      expect(res.text, body.slice(0, 40)).not.toMatch(STACK_RE);
    }
  });

  it("GET / redirects to /book and /book serves the app", async () => {
    const root = await fetch(`${kennel.url}/`, { redirect: "manual" });
    expect(root.status).toBe(302);
    expect(new URL(root.headers.get("location")!, kennel.url).pathname).toBe("/book");
    const book = await fetch(`${kennel.url}/book`);
    expect(book.status).toBe(200);
    expect(book.headers.get("content-type")).toMatch(/text\/html/);
  });
});

describe("mock analytics server", () => {
  let kennel: Kennel;
  beforeAll(async () => {
    kennel = await startKennel("none");
  });
  afterAll(async () => {
    await kennel?.stop();
  });

  it("records GET and POST /collect, exposes /hits, and /reset clears them", async () => {
    await kennel.reset();
    const g = await fetch(`${kennel.analyticsUrl}/collect?event=probe`);
    expect(g.status).toBe(204);
    const p = await fetch(`${kennel.analyticsUrl}/collect`, { method: "POST", body: '{"event":"probe2"}' });
    expect(p.status).toBe(204);
    const hits = await kennel.hits();
    expect(hits).toEqual([
      { method: "GET", url: "/collect?event=probe", body: "" },
      { method: "POST", url: "/collect", body: '{"event":"probe2"}' },
    ]);
    const r = await fetch(`${kennel.analyticsUrl}/reset`, { method: "POST" });
    expect(r.status).toBe(204);
    expect(await kennel.hits()).toEqual([]);
  });

  it("allows cross-origin calls (CORS preflight)", async () => {
    const res = await fetch(`${kennel.analyticsUrl}/collect`, {
      method: "OPTIONS",
      headers: { origin: kennel.url, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("KENNEL_BUGS parsing", () => {
  const started: Kennel[] = [];
  afterAll(async () => {
    await Promise.all(started.map((k) => k.stop()));
  });

  it("'all' enables every V0 bug, sorted", async () => {
    const k = await startKennel("all");
    started.push(k);
    const body = (await (await fetch(`${k.url}/api/__config`)).json()) as { bugs: string[] };
    expect(body.bugs).toEqual([...V0_BUGS].sort());
  });

  it("a comma list is case-insensitive and ignores whitespace", async () => {
    const k = await startKennel(" a03, f01 ");
    started.push(k);
    const body = (await (await fetch(`${k.url}/api/__config`)).json()) as { bugs: string[] };
    expect(body.bugs).toEqual(["A03", "F01"]);
  });
});

describe("API changes under bugs", () => {
  let f06: Kennel;
  let s04: Kennel;
  beforeAll(async () => {
    [f06, s04] = await Promise.all([startKennel("F06"), startKennel("S04")]);
  });
  afterAll(async () => {
    await Promise.all([f06?.stop(), s04?.stop()]);
  });

  it("F06: server accepts end date before start date", async () => {
    const res = await postBooking(f06, validBooking({ startDate: "2030-05-03", endDate: "2030-05-01" }));
    expect(res.status).toBe(201);
    expect(await listBookings(f06)).toHaveLength(1);
  });

  it("F06: other validation still holds", async () => {
    const res = await postBooking(f06, validBooking({ ownerEmail: "nope" }));
    expect(res.status).toBe(400);
    expect(res.json.errors.ownerEmail).toBeTypeOf("string");
  });

  it("S04: 500 response carries a stack trace", async () => {
    const res = await postBooking(s04, validBooking({ petName: "Crash" }));
    expect(res.status).toBe(500);
    expect(res.json.error).toBe("Something went wrong");
    expect(res.json.stack).toBeTypeOf("string");
    expect(res.text).toMatch(STACK_RE);
  });

  it("S04: 400 responses stay clean", async () => {
    const res = await postBooking(s04, {});
    expect(res.status).toBe(400);
    expect(res.text).not.toMatch(STACK_RE);
  });
});
