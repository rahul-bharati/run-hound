// Fernway's seed data: what the in-memory store holds on start and after POST /api/__reset. Node built-ins only.
//
// Field conventions (the client relies on them):
// - ids are strings; seeded records use readable slugs, new records get randomUUID().
// - member.avatar and profile.avatar are indexes into `images.avatars` (src/lib/images.ts).
// - project.status is "active" | "paused" | "done"; project.priority is "low" | "medium" | "high".
// - dates are "YYYY-MM-DD"; timestamps are ISO strings.

import { hashPassword } from "./passwords.mjs";

/** The only account that can sign in (CONTRACT.md, /login). */
export const DEMO_ACCOUNT = Object.freeze({ email: "alex@fernway.test", password: "correct-horse-battery" });

export const PROJECT_STATUSES = Object.freeze(["active", "paused", "done"]);
export const PROJECT_PRIORITIES = Object.freeze(["low", "medium", "high"]);

// Hashed once per process: scrypt is deliberately slow, and /api/__reset runs between every test.
const DEMO_PASSWORD_HASH = hashPassword(DEMO_ACCOUNT.password);

const SEEDED_AT = "2026-09-01T09:00:00.000Z";

/** @typedef {{ id: string, name: string, email: string, role: string, avatar: number }} Member */
/**
 * @typedef {{ id: string, name: string, description: string, status: "active" | "paused" | "done",
 *   priority: "low" | "medium" | "high", ownerId: string, dueDate: string, budget: number, notify: boolean,
 *   progress: number, createdAt: string }} Project
 */
/** @typedef {{ id: string, title: string, projectId: string, done: boolean, createdAt: string }} Task */
/** @typedef {{ displayName: string, email: string, bio: string, timeZone: string, avatar: number }} Profile */
/** @typedef {{ id: string, name: string, email: string, company: string, passwordHash: string, createdAt: string }} User */

/**
 * @typedef {object} Store
 * @property {Member[]} members
 * @property {Project[]} projects      Newest first is the client's job; the store keeps insertion order.
 * @property {Task[]} tasks
 * @property {Profile} profile
 * @property {Record<string, boolean>} notifications  The 4 settings switches.
 * @property {User[]} users
 * @property {Map<string, string>} sessions  session id (fernway_session cookie) -> user id
 * @property {{ id: string, email: string, teamSize: string, position: number, createdAt: string }[]} waitlist
 * @property {number} waitlistBase    The first waitlist entry gets position waitlistBase + 1.
 * @property {Record<string, unknown>[]} demoRequests
 * @property {{ id: string, email: string, createdAt: string }[]} newsletter
 * @property {Record<string, unknown>[]} workspaces   Created by POST /api/onboarding.
 * @property {string[]} takenSlugs     Workspace URLs GET /api/slug-available reports as taken.
 */

/** @returns {Member[]} */
function members() {
  return [
    { id: "alex-rivera", name: "Alex Rivera", email: "alex@fernway.test", role: "Studio lead", avatar: 0 },
    { id: "priya-shah", name: "Priya Shah", email: "priya@fernway.test", role: "Product designer", avatar: 1 },
    { id: "marcus-chen", name: "Marcus Chen", email: "marcus@fernway.test", role: "Engineer", avatar: 2 },
    { id: "sofia-alvarez", name: "Sofia Alvarez", email: "sofia@fernway.test", role: "Project manager", avatar: 3 },
    { id: "jonah-okafor", name: "Jonah Okafor", email: "jonah@fernway.test", role: "Developer", avatar: 4 },
    { id: "emma-lindqvist", name: "Emma Lindqvist", email: "emma@fernway.test", role: "Brand strategist", avatar: 5 },
    { id: "diego-morales", name: "Diego Morales", email: "diego@fernway.test", role: "Motion designer", avatar: 6 },
    { id: "hana-sato", name: "Hana Sato", email: "hana@fernway.test", role: "Copywriter", avatar: 7 },
  ];
}

/** @returns {Project[]} */
function projects() {
  /** @param {Omit<Project, "createdAt">} fields @returns {Project} */
  const p = (fields) => ({ ...fields, createdAt: SEEDED_AT });
  return [
    p({
      id: "northwind-rebrand",
      name: "Northwind rebrand",
      description: "New identity, type system and launch assets for Northwind Outfitters.",
      status: "active",
      priority: "high",
      ownerId: "priya-shah",
      dueDate: "2026-11-14",
      budget: 18000,
      notify: true,
      progress: 64,
    }),
    p({
      id: "atlas-mobile-app",
      name: "Atlas mobile app",
      description: "iOS and Android booking app for Atlas Climbing gyms.",
      status: "active",
      priority: "medium",
      ownerId: "marcus-chen",
      dueDate: "2026-12-05",
      budget: 32000,
      notify: true,
      progress: 38,
    }),
    p({
      id: "juniper-website",
      name: "Juniper website refresh",
      description: "Marketing site rebuild with a new CMS and case studies.",
      status: "active",
      priority: "high",
      ownerId: "sofia-alvarez",
      dueDate: "2026-10-30",
      budget: 12500,
      notify: false,
      progress: 81,
    }),
    p({
      id: "harbor-launch-video",
      name: "Harbor & Co. launch video",
      description: "60-second product film and social cut-downs.",
      status: "paused",
      priority: "low",
      ownerId: "diego-morales",
      dueDate: "2027-01-20",
      budget: 9000,
      notify: false,
      progress: 22,
    }),
    p({
      id: "maple-brand-book",
      name: "Maple Studio brand book",
      description: "Brand guidelines, templates and a tone-of-voice guide.",
      status: "done",
      priority: "medium",
      ownerId: "emma-lindqvist",
      dueDate: "2026-09-12",
      budget: 7500,
      notify: true,
      progress: 100,
    }),
    p({
      id: "q3-client-reporting",
      name: "Q3 client reporting",
      description: "Quarterly reports and retros for every active client.",
      status: "done",
      priority: "low",
      ownerId: "alex-rivera",
      dueDate: "2026-09-01",
      budget: 3000,
      notify: false,
      progress: 100,
    }),
  ];
}

/** @returns {Task[]} */
function tasks() {
  return [
    { id: "task-wireframes", title: "Review homepage wireframes", projectId: "juniper-website", done: false, createdAt: SEEDED_AT },
    { id: "task-sprint-notes", title: "Send sprint notes to Atlas", projectId: "atlas-mobile-app", done: false, createdAt: SEEDED_AT },
    { id: "task-palette", title: "Approve the Northwind color palette", projectId: "northwind-rebrand", done: true, createdAt: SEEDED_AT },
  ];
}

/**
 * A fresh copy of the seed (nothing shared between calls, so a reset never sees earlier mutations).
 * @returns {Store}
 */
export function createSeed() {
  return {
    members: members(),
    projects: projects(),
    tasks: tasks(),
    profile: {
      displayName: "Alex Rivera",
      email: "alex@fernway.test",
      bio: "Studio lead at Fernway. I plan projects, keep timelines honest and make sure every client hears from us weekly.",
      timeZone: "America/New_York",
      avatar: 0,
    },
    notifications: { productUpdates: true, weeklyDigest: true, mentions: true, taskReminders: false },
    users: [
      {
        id: "alex-rivera",
        name: "Alex Rivera",
        email: DEMO_ACCOUNT.email,
        company: "Fernway Studio",
        passwordHash: DEMO_PASSWORD_HASH,
        createdAt: SEEDED_AT,
      },
    ],
    sessions: new Map(),
    waitlist: [],
    waitlistBase: 1283,
    demoRequests: [],
    newsletter: [],
    workspaces: [],
    takenSlugs: ["acme", "admin", "app", "fernway", "studio"],
  };
}
