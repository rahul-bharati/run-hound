import { z } from "zod";
import { AUTH_MESSAGES } from "../auth/schemas";

/** Field messages; server/routes/onboarding.mjs (ONBOARDING_MESSAGES) sends the same wording. */
export const ONBOARDING_MESSAGES = {
  nameRequired: "Enter a workspace name.",
  nameLong: "Use 60 characters or fewer.",
  slugRequired: "Choose a workspace URL.",
  slugInvalid: "Use 3–40 lowercase letters, numbers or hyphens.",
  slugTaken: "That URL is already taken. Try another one.",
} as const;

/** 3-40 characters: lowercase letters, numbers and single hyphens, starting and ending with a letter or number. */
export const SLUG_RE = /^(?=.{3,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_PREFIX = "fernway.app/";
export const MAX_INVITES = 3;

/**
 * Turns anything typed into a slug: lower case, accents dropped, runs of other characters become one hyphen, at
 * most 40 characters. `finished` also drops a trailing hyphen (for a slug derived from the workspace name; while
 * typing the URL itself a trailing hyphen is kept so "my-" can become "my-studio").
 */
export function slugify(value: string, finished = false): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40);
  return finished ? slug.replace(/-+$/, "") : slug;
}

export const USE_CASE_VALUES = ["client", "internal", "personal"] as const;
export type UseCase = (typeof USE_CASE_VALUES)[number];

export const workspaceSchema = z.object({
  workspaceName: z.string().trim().min(1, ONBOARDING_MESSAGES.nameRequired).max(60, ONBOARDING_MESSAGES.nameLong),
  slug: z.string().trim().min(1, ONBOARDING_MESSAGES.slugRequired).regex(SLUG_RE, ONBOARDING_MESSAGES.slugInvalid),
  useCase: z.enum(USE_CASE_VALUES),
});
export type WorkspaceValues = z.input<typeof workspaceSchema>;

const emailFormat = z.email();

export const invitesSchema = z.object({
  invites: z
    .array(
      z.object({
        email: z
          .string()
          .trim()
          .refine((value) => value === "" || emailFormat.safeParse(value).success, AUTH_MESSAGES.emailInvalid),
      }),
    )
    .max(MAX_INVITES),
});
export type InvitesValues = z.input<typeof invitesSchema>;

/** The invite emails to send: filled in, lower case, each once. */
export function inviteList(invites: InvitesValues["invites"]): string[] {
  return [...new Set(invites.map((i) => i.email.trim().toLowerCase()).filter(Boolean))];
}

/** What POST /api/onboarding answers. */
export interface CreatedWorkspace {
  id: string;
  workspaceName: string;
  slug: string;
  useCase: UseCase;
  invites: string[];
  url: string;
  createdAt: string;
}
