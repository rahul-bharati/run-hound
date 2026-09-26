import { uuid } from "./utils";

/** Field-level messages from a 400/409 body: `{ errors: { <field>: <message> } }`. */
export type FieldErrors = Record<string, string>;

/**
 * A failed API call. `status` is the HTTP status, or 0 for a network failure. `errors` is the server's field map
 * ({} when there is none); `message` is safe to show (the server's `error`, or a generic sentence).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly errors: FieldErrors;
  readonly body: unknown;

  constructor(status: number, message: string, errors: FieldErrors = {}, body: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
    this.body = body;
  }

  /** True for a network failure (no HTTP response). */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiOptions {
  method?: HttpMethod;
  /** JSON-serialised as the request body. */
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Idempotency-Key for a save request. Default: a fresh UUID per call on every non-GET request, so one submit is
   * one key. Pass a string to reuse a key across retries, or `false` to send none.
   */
  idempotencyKey?: string | false;
}

const NETWORK_MESSAGE = "We couldn't reach Fernway. Check your connection and try again.";
const SERVER_MESSAGE = "Something went wrong on our side. Please try again.";

function messageFor(status: number, body: unknown): { message: string; errors: FieldErrors } {
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const errors: FieldErrors = {};
  if (obj.errors && typeof obj.errors === "object") {
    for (const [k, v] of Object.entries(obj.errors as Record<string, unknown>)) if (typeof v === "string") errors[k] = v;
  }
  if (typeof obj.error === "string" && obj.error && status < 500) return { message: obj.error, errors };
  if (status >= 500) return { message: SERVER_MESSAGE, errors };
  const first = Object.values(errors)[0];
  return { message: first ?? `Request failed (${status}).`, errors };
}

/**
 * Calls Fernway's JSON API (same origin). Resolves with the parsed JSON body (undefined for 204); rejects with an
 * ApiError for any non-2xx status or a network failure. Non-GET requests carry an Idempotency-Key header.
 */
export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") {
    const key = options.idempotencyKey === undefined ? uuid() : options.idempotencyKey;
    if (key) headers["idempotency-key"] = key;
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, NETWORK_MESSAGE);
  }

  const text = res.status === 204 ? "" : await res.text().catch(() => "");
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const { message, errors } = messageFor(res.status, body);
    throw new ApiError(res.status, message, errors, body ?? null);
  }
  return body as T;
}

type BodyOptions = Omit<ApiOptions, "method" | "body">;

export const apiGet = <T = unknown>(path: string, options: Omit<ApiOptions, "method" | "body" | "idempotencyKey"> = {}) =>
  api<T>(path, { ...options, method: "GET" });
export const apiPost = <T = unknown>(path: string, body?: unknown, options: BodyOptions = {}) =>
  api<T>(path, { ...options, method: "POST", body });
export const apiPut = <T = unknown>(path: string, body?: unknown, options: BodyOptions = {}) =>
  api<T>(path, { ...options, method: "PUT", body });
export const apiPatch = <T = unknown>(path: string, body?: unknown, options: BodyOptions = {}) =>
  api<T>(path, { ...options, method: "PATCH", body });
export const apiDelete = <T = unknown>(path: string, options: BodyOptions = {}) =>
  api<T>(path, { ...options, method: "DELETE" });

// ---- shared record types (server/seed.mjs is the source of truth) --------------------------------

export type ProjectStatus = "active" | "paused" | "done";
export type ProjectPriority = "low" | "medium" | "high";

export interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  /** Index into `images.avatars`, or null for no photo (initials). */
  avatar: number | null;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  ownerId: string;
  dueDate: string;
  budget: number;
  notify: boolean;
  progress: number;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  projectId: string;
  done: boolean;
  createdAt: string;
}

/** GET/PUT /api/users/:id/profile. `role` and `plan` are read-only: the server never takes them from the client. */
export interface Profile {
  id: string;
  displayName: string;
  email: string;
  bio: string;
  timeZone: string;
  /** Index into `images.avatars`, or null for no photo (initials). */
  avatar: number | null;
  role: string;
  plan: string;
}

/** The profile endpoint of a user (the Settings page uses the signed-in user's id from GET /api/me). */
export const profilePath = (userId: string) => `/api/users/${encodeURIComponent(userId)}/profile`;

/** The update endpoint of a task (PATCH with the whole task: title, projectId, done). */
export const taskPath = (taskId: string) => `/api/tasks/${encodeURIComponent(taskId)}`;

/** What the client sends to PATCH /api/tasks/:id: the task's editable fields, all of them. */
export const taskUpdate = (task: Pick<Task, "title" | "projectId" | "done">) => ({ title: task.title, projectId: task.projectId, done: task.done });

/** An upgrade started with POST /api/billing/checkout (server/routes/billing.mjs). `amount` is in cents. */
export interface Checkout {
  id: string;
  plan: string;
  amount: number;
  currency: string;
  status: "open" | "paid" | "fulfilled";
}

/** POST /api/billing/confirm: whether the checkout was paid and the plan granted, and the account's plan now. */
export interface UpgradeConfirmation {
  confirmed: boolean;
  plan: string;
}

/** Where the local test checkout lands after paying (the SPA's success page). */
export const upgradedPath = (checkoutId?: string) => (checkoutId ? `/app/upgraded?checkout=${encodeURIComponent(checkoutId)}` : "/app/upgraded");

export type NotificationSettings = Record<string, boolean>;
