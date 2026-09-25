import { z } from "zod";

/** Field messages; server/routes/auth.mjs (AUTH_MESSAGES) sends the same wording, so server errors read the same. */
export const AUTH_MESSAGES = {
  nameRequired: "Enter your full name.",
  nameLong: "Use 80 characters or fewer.",
  workEmailRequired: "Enter your work email.",
  emailRequired: "Enter your email address.",
  emailInvalid: "Enter an email address like name@studio.com.",
  passwordNew: "Create a password.",
  passwordShort: "Use at least 8 characters.",
  passwordLong: "Use 128 characters or fewer.",
  passwordRequired: "Enter your password.",
  companyLong: "Use 100 characters or fewer.",
  terms: "Agree to the Terms and Privacy Policy to continue.",
} as const;

export const PASSWORD_MIN = 8;

/** A trimmed, required email: "required" when empty, then the format check. */
export const emailField = (required: string) => z.string().trim().min(1, required).pipe(z.email(AUTH_MESSAGES.emailInvalid));

export const signupSchema = z.object({
  name: z.string().trim().min(1, AUTH_MESSAGES.nameRequired).max(80, AUTH_MESSAGES.nameLong),
  email: emailField(AUTH_MESSAGES.workEmailRequired),
  // Never trimmed: spaces are part of a password.
  password: z.string().min(1, AUTH_MESSAGES.passwordNew).min(PASSWORD_MIN, AUTH_MESSAGES.passwordShort).max(128, AUTH_MESSAGES.passwordLong),
  company: z.string().trim().max(100, AUTH_MESSAGES.companyLong),
  terms: z.boolean().refine((checked) => checked, AUTH_MESSAGES.terms),
});
export type SignupValues = z.input<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailField(AUTH_MESSAGES.emailRequired),
  password: z.string().min(1, AUTH_MESSAGES.passwordRequired),
  remember: z.boolean(),
});
export type LoginValues = z.input<typeof loginSchema>;

/** What POST /api/signup and /api/login answer. */
export interface AccountUser {
  id: string;
  name: string;
  email: string;
}

export type Strength = "Weak" | "Fair" | "Strong";

/**
 * A simple strength estimate for the sign-up meter: length and character variety. Under 8 characters is always
 * "Weak"; 12+ characters with 3 kinds of characters is "Strong".
 */
export function passwordStrength(password: string): { level: 0 | 1 | 2 | 3; label: Strength | "" } {
  if (!password) return { level: 0, label: "" };
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const points = Number(password.length >= PASSWORD_MIN) + Number(password.length >= 12) + Number(variety >= 2) + Number(variety >= 3);
  if (password.length < PASSWORD_MIN || points <= 1) return { level: 1, label: "Weak" };
  if (points <= 3) return { level: 2, label: "Fair" };
  return { level: 3, label: "Strong" };
}

/** "Maya Patel" -> "Maya". */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Where to go after signing in: a same-origin path from ?next= (V2 sends signed-out visitors to /login?next=<path>),
 * else /app. Anything that could leave the origin ("//host", "/\\host", "https:") falls back to /app.
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/app";
  try {
    const url = new URL(next, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : "/app";
  } catch {
    return "/app";
  }
}
