// Onboarding endpoints (/onboarding). See CONTRACT.md "API".
//
//   GET  /api/slug-available?slug=  -> 200 { slug, available } (seeded takenSlugs and created workspaces are taken;
//                                      compared lower-case); a malformed slug -> 400 on `slug`.
//   POST /api/onboarding            { workspaceName, slug, useCase, invites[] } -> 201 { id, workspaceName, slug,
//                                      useCase, invites, url, createdAt }; a taken slug -> 409 on `slug`;
//                                      workspaceName "Crash" -> 500.
//
// Data: ctx.store.workspaces, ctx.store.takenSlugs.

import { badRequest, conflict, crashIfNamed, created, EMAIL_RE, ok, validator } from "../http.mjs";

/** 3-40 characters: lowercase letters, numbers and single hyphens, starting and ending with a letter or number. */
export const SLUG_RE = /^(?=.{3,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const USE_CASES = Object.freeze(["client", "internal", "personal"]);
export const MAX_INVITES = 3;

/** Messages the client shows on the fields (src/pages/onboarding/schema.ts uses the same wording). */
export const ONBOARDING_MESSAGES = Object.freeze({
  nameRequired: "Enter a workspace name.",
  nameLong: "Use 60 characters or fewer.",
  slugRequired: "Choose a workspace URL.",
  slugInvalid: "Use 3–40 lowercase letters, numbers or hyphens.",
  slugTaken: "That URL is already taken. Try another one.",
  useCaseRequired: "Choose how you'll use Fernway.",
  invitesMax: "Invite up to 3 teammates for now.",
  invitesInvalid: "Enter valid email addresses for your teammates.",
});

/**
 * @param {import("../http.mjs").Router} router
 * @param {import("../app.mjs").AppContext} ctx
 */
export function register(router, ctx) {
  /** @param {string} slug */
  const isTaken = (slug) => ctx.store.takenSlugs.includes(slug) || ctx.store.workspaces.some((w) => w.slug === slug);

  router.get("/api/slug-available", ({ query }) => {
    const slug = (query.get("slug") ?? "").trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return badRequest({ slug: ONBOARDING_MESSAGES.slugInvalid });
    return ok({ slug, available: !isTaken(slug) });
  });

  router.post("/api/onboarding", ({ body, cookies }) => {
    const v = validator(body);
    const workspaceName = v.text("workspaceName", { required: ONBOARDING_MESSAGES.nameRequired, max: 60, maxMessage: ONBOARDING_MESSAGES.nameLong });
    const rawSlug = v.text("slug", { required: ONBOARDING_MESSAGES.slugRequired });
    const slug = rawSlug.toLowerCase();
    if (rawSlug && !SLUG_RE.test(slug)) v.fail("slug", ONBOARDING_MESSAGES.slugInvalid);
    const useCase = v.oneOf("useCase", USE_CASES, { required: ONBOARDING_MESSAGES.useCaseRequired });
    const listed = v.stringArray("invites", { max: MAX_INVITES, maxMessage: ONBOARDING_MESSAGES.invitesMax });
    const invites = [...new Set(listed.map((email) => email.toLowerCase()))];
    if (invites.some((email) => email.length > 254 || !EMAIL_RE.test(email))) v.fail("invites", ONBOARDING_MESSAGES.invitesInvalid);
    if (!v.ok) return badRequest(v.errors);

    crashIfNamed(workspaceName);
    if (isTaken(slug)) return conflict({ slug: ONBOARDING_MESSAGES.slugTaken });

    const workspace = {
      id: ctx.newId(),
      workspaceName,
      slug,
      useCase,
      invites,
      url: `fernway.app/${slug}`,
      createdAt: ctx.now(),
    };
    ctx.store.workspaces.push({ ...workspace, ownerId: ctx.sessionUser(cookies)?.id ?? null });
    return created(workspace);
  });
}
