// Fernway's seed data: what the in-memory store holds on start and after POST /api/__reset. Node built-ins only.
//
// V2 (CONTRACT.md "Accounts"): two seeded users, Alex (the demo account) and Sam, each with a workspace of their own
// (members, projects, tasks, profile and notification settings). A user signed up later gets an empty workspace.
//
// Field conventions (the client relies on them):
// - ids are strings; seeded records use readable slugs (unique across users), new records get randomUUID().
// - member.avatar and profile.avatar are indexes into `images.avatars` (src/lib/images.ts), or null for no photo
//   (the client shows initials).
// - project.status is "active" | "paused" | "done"; project.priority is "low" | "medium" | "high".
// - dates are "YYYY-MM-DD"; timestamps are ISO strings.

import { hashPassword } from "./passwords.mjs";

/**
 * The seeded accounts (CONTRACT.md "Accounts"). The passwords live here and in the docs only: never in the client
 * bundle, never on a page.
 */
export const ACCOUNTS = Object.freeze({
  alex: Object.freeze({
    id: "alex-rivera",
    email: "alex@fernway.test",
    password: "correct-horse-battery",
    name: "Alex Rivera",
    workspace: "Rivera Studio",
  }),
  sam: Object.freeze({
    id: "sam-okafor",
    email: "sam@fernway.test",
    password: "staple-lemon-orbit",
    name: "Sam Okafor",
    workspace: "Okafor & Co",
  }),
});

/** Alex, the account "Use the demo account" signs in as (and V03's fallback user). */
export const DEMO_ACCOUNT = Object.freeze({ email: ACCOUNTS.alex.email, password: ACCOUNTS.alex.password });

export const PROJECT_STATUSES = Object.freeze(["active", "paused", "done"]);
export const PROJECT_PRIORITIES = Object.freeze(["low", "medium", "high"]);

/** The privilege fields of a profile record: returned by the API, never accepted from a client (except under V04). */
export const PROFILE_DEFAULTS = Object.freeze({ role: "member", plan: "free" });

/** The 4 notification switches of a new workspace. */
export const DEFAULT_NOTIFICATIONS = Object.freeze({ productUpdates: true, weeklyDigest: true, mentions: true, taskReminders: false });

// Hashed once per process: scrypt is deliberately slow, and /api/__reset runs between every test.
const PASSWORD_HASHES = Object.freeze({
  alex: hashPassword(ACCOUNTS.alex.password),
  sam: hashPassword(ACCOUNTS.sam.password),
});

const SEEDED_AT = "2026-09-01T09:00:00.000Z";

/** @typedef {{ id: string, name: string, email: string, role: string, avatar: number | null }} Member */
/**
 * @typedef {{ id: string, name: string, description: string, status: "active" | "paused" | "done",
 *   priority: "low" | "medium" | "high", ownerId: string, dueDate: string, budget: number, notify: boolean,
 *   progress: number, createdAt: string, archived?: boolean }} Project
 */
/** @typedef {{ id: string, title: string, projectId: string, done: boolean, createdAt: string }} Task */
/**
 * The stored profile record (GET /api/users/:id/profile). `role` and `plan` are privilege fields: the API returns
 * them but only ever takes displayName, email, bio and timeZone from a client. Under V04 any other key sent is stored
 * too, hence the index signature.
 * @typedef {{ id: string, displayName: string, email: string, bio: string, timeZone: string, avatar: number | null,
 *   role: string, plan: string, [key: string]: unknown }} Profile
 */
/** @typedef {{ id: string, name: string, email: string, company: string, passwordHash: string, createdAt: string }} User */
/**
 * One user's workspace: everything the workspace API reads and writes for that user.
 * @typedef {{ name: string, members: Member[], projects: Project[], tasks: Task[], profile: Profile,
 *   notifications: Record<string, boolean> }} Workspace
 */

/**
 * @typedef {object} Store
 * @property {User[]} users
 * @property {Map<string, string>} sessions  session id (fernway_session cookie) -> user id. Survives POST /api/__reset.
 * @property {Map<string, Workspace>} workspaces  user id -> that user's workspace
 * @property {{ id: string, email: string, teamSize: string, position: number, createdAt: string }[]} waitlist
 * @property {number} waitlistBase    The first waitlist entry gets position waitlistBase + 1.
 * @property {Record<string, unknown>[]} demoRequests
 * @property {{ id: string, email: string, createdAt: string }[]} newsletter
 * @property {Record<string, unknown>[]} onboardings  Created by POST /api/onboarding.
 * @property {string[]} takenSlugs     Workspace URLs GET /api/slug-available reports as taken.
 * @property {Checkout[]} checkouts    The local test checkout's sessions (server/routes/billing.mjs).
 */

/**
 * One upgrade started with POST /api/billing/checkout. `status` is "open" until the local test payment marks it
 * "paid"; confirming it on /app/upgraded makes it "fulfilled" (the plan was granted once).
 * @typedef {{ id: string, userId: string, plan: string, amount: number, currency: string,
 *   status: "open" | "paid" | "fulfilled", createdAt: string }} Checkout
 */

/** @param {Omit<Project, "createdAt">} fields @returns {Project} */
const project = (fields) => ({ ...fields, createdAt: SEEDED_AT });

/** @returns {Workspace} Alex's "Rivera Studio" (the V0/V1 demo workspace, unchanged). */
function riveraStudio() {
  return {
    name: ACCOUNTS.alex.workspace,
    members: [
      { id: "alex-rivera", name: "Alex Rivera", email: "alex@fernway.test", role: "Studio lead", avatar: 0 },
      { id: "priya-shah", name: "Priya Shah", email: "priya@fernway.test", role: "Product designer", avatar: 1 },
      { id: "marcus-chen", name: "Marcus Chen", email: "marcus@fernway.test", role: "Engineer", avatar: 2 },
      { id: "sofia-alvarez", name: "Sofia Alvarez", email: "sofia@fernway.test", role: "Project manager", avatar: 3 },
      { id: "jonah-okafor", name: "Jonah Okafor", email: "jonah@fernway.test", role: "Developer", avatar: 4 },
      { id: "emma-lindqvist", name: "Emma Lindqvist", email: "emma@fernway.test", role: "Brand strategist", avatar: 5 },
      { id: "diego-morales", name: "Diego Morales", email: "diego@fernway.test", role: "Motion designer", avatar: 6 },
      { id: "hana-sato", name: "Hana Sato", email: "hana@fernway.test", role: "Copywriter", avatar: 7 },
    ],
    projects: [
      project({
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
      project({
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
      project({
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
      project({
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
      project({
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
      project({
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
    ],
    tasks: [
      { id: "task-wireframes", title: "Review homepage wireframes", projectId: "juniper-website", done: false, createdAt: SEEDED_AT },
      { id: "task-sprint-notes", title: "Send sprint notes to Atlas", projectId: "atlas-mobile-app", done: false, createdAt: SEEDED_AT },
      { id: "task-palette", title: "Approve the Northwind color palette", projectId: "northwind-rebrand", done: true, createdAt: SEEDED_AT },
    ],
    profile: {
      id: ACCOUNTS.alex.id,
      displayName: "Alex Rivera",
      email: "alex@fernway.test",
      bio: "Studio lead at Fernway. I plan projects, keep timelines honest and make sure every client hears from us weekly.",
      timeZone: "America/New_York",
      avatar: 0,
      ...PROFILE_DEFAULTS,
    },
    notifications: { ...DEFAULT_NOTIFICATIONS },
  };
}

/** @returns {Workspace} Sam's "Okafor & Co": nothing in it names Alex or anything of Alex's. */
function okaforAndCo() {
  return {
    name: ACCOUNTS.sam.workspace,
    members: [
      { id: "sam-okafor", name: "Sam Okafor", email: "sam@fernway.test", role: "Founder", avatar: null },
      { id: "lena-brandt", name: "Lena Brandt", email: "lena@okafor.test", role: "Designer", avatar: null },
      { id: "tomas-silva", name: "Tomás Silva", email: "tomas@okafor.test", role: "Developer", avatar: null },
      { id: "ruth-mensah", name: "Ruth Mensah", email: "ruth@okafor.test", role: "Producer", avatar: null },
      { id: "kenji-ito", name: "Kenji Ito", email: "kenji@okafor.test", role: "Illustrator", avatar: null },
    ],
    projects: [
      project({
        id: "bramble-bakery-identity",
        name: "Bramble Bakery identity",
        description: "Logo, packaging and shop signage for a neighbourhood bakery.",
        status: "active",
        priority: "high",
        ownerId: "lena-brandt",
        dueDate: "2026-11-02",
        budget: 8500,
        notify: true,
        progress: 45,
      }),
      project({
        id: "metro-trip-planner",
        name: "Metro Line trip planner",
        description: "A progressive web app for planning trips across three bus networks.",
        status: "active",
        priority: "medium",
        ownerId: "tomas-silva",
        dueDate: "2027-01-15",
        budget: 27000,
        notify: true,
        progress: 30,
      }),
      project({
        id: "harbour-museum-site",
        name: "Harbour Museum website",
        description: "Exhibition pages, ticketing and an accessible collection browser.",
        status: "active",
        priority: "high",
        ownerId: "sam-okafor",
        dueDate: "2026-12-12",
        budget: 21000,
        notify: false,
        progress: 58,
      }),
      project({
        id: "night-shift-podcast-art",
        name: "Night Shift podcast artwork",
        description: "Cover art and episode cards for a late-night interview show.",
        status: "paused",
        priority: "low",
        ownerId: "kenji-ito",
        dueDate: "2027-02-01",
        budget: 2500,
        notify: false,
        progress: 15,
      }),
      project({
        id: "greenway-annual-report",
        name: "Greenway annual report",
        description: "Print and web editions of a cycling charity's yearly report.",
        status: "done",
        priority: "medium",
        ownerId: "ruth-mensah",
        dueDate: "2026-09-05",
        budget: 6000,
        notify: true,
        progress: 100,
      }),
      project({
        id: "okafor-invoicing-cleanup",
        name: "Invoicing clean-up",
        description: "Move every client to the new invoice templates and payment terms.",
        status: "done",
        priority: "low",
        ownerId: "sam-okafor",
        dueDate: "2026-08-29",
        budget: 1000,
        notify: false,
        progress: 100,
      }),
    ],
    tasks: [
      { id: "task-bramble-sketches", title: "Sketch the Bramble logo options", projectId: "bramble-bakery-identity", done: false, createdAt: SEEDED_AT },
      { id: "task-offline-mode", title: "Test the trip planner offline", projectId: "metro-trip-planner", done: false, createdAt: SEEDED_AT },
      { id: "task-print-proofs", title: "Send Greenway the print proofs", projectId: "greenway-annual-report", done: true, createdAt: SEEDED_AT },
    ],
    profile: {
      id: ACCOUNTS.sam.id,
      displayName: "Sam Okafor",
      email: "sam@fernway.test",
      bio: "Founder of Okafor & Co. Small team, clear maps, strong tea.",
      timeZone: "Europe/London",
      avatar: null,
      ...PROFILE_DEFAULTS,
    },
    notifications: { ...DEFAULT_NOTIFICATIONS },
  };
}

/**
 * The empty workspace a new sign-up gets: the user as its only member, no projects or tasks, a profile from the
 * sign-up fields and the default notification settings.
 * @param {{ id: string, name: string, email: string, company: string }} user
 * @returns {Workspace}
 */
export function emptyWorkspace(user) {
  const first = user.name.trim().split(/\s+/)[0] || user.name;
  return {
    name: user.company || `${first}'s workspace`,
    members: [{ id: user.id, name: user.name, email: user.email, role: "Owner", avatar: null }],
    projects: [],
    tasks: [],
    profile: { id: user.id, displayName: user.name.slice(0, 60), email: user.email, bio: "", timeZone: "UTC", avatar: null, ...PROFILE_DEFAULTS },
    notifications: { ...DEFAULT_NOTIFICATIONS },
  };
}

/**
 * A fresh copy of the seed (nothing shared between calls, so a reset never sees earlier mutations).
 * @returns {Store}
 */
export function createSeed() {
  return {
    users: [
      {
        id: ACCOUNTS.alex.id,
        name: ACCOUNTS.alex.name,
        email: ACCOUNTS.alex.email,
        company: ACCOUNTS.alex.workspace,
        passwordHash: PASSWORD_HASHES.alex,
        createdAt: SEEDED_AT,
      },
      {
        id: ACCOUNTS.sam.id,
        name: ACCOUNTS.sam.name,
        email: ACCOUNTS.sam.email,
        company: ACCOUNTS.sam.workspace,
        passwordHash: PASSWORD_HASHES.sam,
        createdAt: SEEDED_AT,
      },
    ],
    sessions: new Map(),
    workspaces: new Map([
      [ACCOUNTS.alex.id, riveraStudio()],
      [ACCOUNTS.sam.id, okaforAndCo()],
    ]),
    waitlist: [],
    waitlistBase: 1283,
    demoRequests: [],
    newsletter: [],
    onboardings: [],
    takenSlugs: ["acme", "admin", "app", "fernway", "studio"],
    checkouts: [],
  };
}
