// Marketing endpoints (the landing page, "/"). See CONTRACT.md "/ Landing" and "API".
//
//   POST /api/waitlist        { email, teamSize } -> 201 { id, email, teamSize, position }; the same email again ->
//                             409 { errors: { email: "This email is already on the list" } }
//   POST /api/demo-requests   { name, email, companySize, date, message, consent } -> 201 the saved request
//                             (name "Crash" -> 500)
//   POST /api/newsletter      { email } -> 201 { id, createdAt }; the address is never echoed back, and signing up
//                             twice answers the first subscription again (it does not reveal who is subscribed)
//
// Data: ctx.store.waitlist, ctx.store.waitlistBase, ctx.store.demoRequests, ctx.store.newsletter (server/seed.mjs).

import { badRequest, conflict, crashIfNamed, created, today, validator } from "../http.mjs";

/** Waitlist "Team size" options (en dashes; the landing page shows the same strings). */
export const TEAM_SIZES = Object.freeze(["1–5", "6–20", "21–50", "51+"]);

/** Demo form "Company size" options. */
export const COMPANY_SIZES = Object.freeze(["1–10", "11–50", "51–200", "201+"]);

/** Server-side messages; the client shows the same wording for its own validation. */
export const MESSAGES = Object.freeze({
  emailRequired: "Enter your work email.",
  newsletterEmailRequired: "Enter your email address.",
  teamSizeRequired: "Choose your team size.",
  emailTaken: "This email is already on the list",
  nameRequired: "Enter your full name.",
  companySizeRequired: "Choose your company size.",
  dateRequired: "Choose a preferred date.",
  datePast: "Choose today or a later date.",
  consentRequired: "Agree to be contacted so we can schedule your demo.",
});

/**
 * The earliest preferred date accepted: yesterday in UTC. The page's date input uses the visitor's local "today" as
 * its minimum, which can be a day behind UTC; a day of slack keeps those visitors from being refused.
 */
function earliestDemoDate() {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {import("../http.mjs").Router} router
 * @param {import("../app.mjs").AppContext} ctx
 */
export function register(router, ctx) {
  router.post("/api/waitlist", ({ body }) => {
    const v = validator(body);
    const email = v.email("email", { required: MESSAGES.emailRequired });
    const teamSize = v.oneOf("teamSize", TEAM_SIZES, { required: MESSAGES.teamSizeRequired });
    if (!v.ok) return badRequest(v.errors);

    const { store } = ctx;
    if (store.waitlist.some((entry) => entry.email === email)) return conflict({ email: MESSAGES.emailTaken });
    const entry = {
      id: ctx.newId(),
      email,
      teamSize,
      position: store.waitlistBase + store.waitlist.length + 1,
      createdAt: ctx.now(),
    };
    store.waitlist.push(entry);
    return created({ id: entry.id, email: entry.email, teamSize: entry.teamSize, position: entry.position });
  });

  router.post("/api/demo-requests", ({ body }) => {
    const v = validator(body);
    const name = v.text("name", { required: MESSAGES.nameRequired, max: 100 });
    const email = v.email("email", { required: MESSAGES.emailRequired });
    const companySize = v.oneOf("companySize", COMPANY_SIZES, { required: MESSAGES.companySizeRequired });
    const date = v.date("date", { required: MESSAGES.dateRequired, notBefore: earliestDemoDate(), notBeforeMessage: MESSAGES.datePast });
    const message = v.text("message", { max: 1000 });
    const consent = v.boolean("consent", { mustBeTrue: MESSAGES.consentRequired });
    if (!v.ok) return badRequest(v.errors);
    crashIfNamed(name);

    const record = { id: ctx.newId(), name, email, companySize, date, message, consent, createdAt: ctx.now() };
    ctx.store.demoRequests.push(record);
    return created(record);
  });

  router.post("/api/newsletter", ({ body }) => {
    const v = validator(body);
    const email = v.email("email", { required: MESSAGES.newsletterEmailRequired });
    if (!v.ok) return badRequest(v.errors);

    const { store } = ctx;
    const existing = store.newsletter.find((entry) => entry.email === email);
    if (existing) return created({ id: existing.id, createdAt: existing.createdAt });
    const entry = { id: ctx.newId(), email, createdAt: ctx.now() };
    store.newsletter.push(entry);
    return created({ id: entry.id, createdAt: entry.createdAt });
  });
}
