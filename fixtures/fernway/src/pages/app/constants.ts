/**
 * Workspace constants shared by the dashboard and settings pages. Plain data only (no React, no icons), so tests can
 * import it and compare it with the server's lists (server/routes/workspace.mjs).
 */
import type { ProjectPriority, ProjectStatus } from "@/lib/api";

export const PROJECT_STATUS_OPTIONS: readonly { value: ProjectStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "done", label: "Done" },
];

export const PROJECT_PRIORITY_OPTIONS: readonly { value: ProjectPriority; label: string; hint: string }[] = [
  { value: "low", label: "Low", hint: "When there's time" },
  { value: "medium", label: "Medium", hint: "This month" },
  { value: "high", label: "High", hint: "Top of the list" },
];

export const statusLabel = (status: ProjectStatus) => PROJECT_STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status;
export const priorityLabel = (priority: ProjectPriority) => PROJECT_PRIORITY_OPTIONS.find((p) => p.value === priority)?.label ?? priority;

/** The New project "Budget" slider (dollars); the server enforces the same range and step. */
export const BUDGET = { min: 0, max: 50_000, step: 500, default: 10_000 } as const;

/** Field limits, the same as the server's. */
export const LIMITS = { projectName: 80, description: 500, taskTitle: 120, displayName: 60, bio: 160 } as const;

/** Settings "Time zone" choices; the values are the server's TIME_ZONES, in the same order. */
export const TIME_ZONE_OPTIONS = [
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
  { value: "America/Denver", label: "Mountain Time (Denver)" },
  { value: "America/Chicago", label: "Central Time (Chicago)" },
  { value: "America/New_York", label: "Eastern Time (New York)" },
  { value: "America/Sao_Paulo", label: "Brasília Time (São Paulo)" },
  { value: "UTC", label: "Coordinated Universal Time (UTC)" },
  { value: "Europe/London", label: "UK Time (London)" },
  { value: "Europe/Berlin", label: "Central European Time (Berlin)" },
  { value: "Africa/Lagos", label: "West Africa Time (Lagos)" },
  { value: "Asia/Kolkata", label: "India Time (Kolkata)" },
  { value: "Asia/Singapore", label: "Singapore Time (Singapore)" },
  { value: "Asia/Tokyo", label: "Japan Time (Tokyo)" },
  { value: "Australia/Sydney", label: "Australian Eastern Time (Sydney)" },
] as const;

export type TimeZoneId = (typeof TIME_ZONE_OPTIONS)[number]["value"];
export const TIME_ZONE_IDS = TIME_ZONE_OPTIONS.map((t) => t.value) as [TimeZoneId, ...TimeZoneId[]];

/** The 4 notification switches (server/seed.mjs `notifications`), in display order. */
export const NOTIFICATION_SETTINGS = [
  { key: "productUpdates", label: "Product updates", description: "New features and improvements, about once a month." },
  { key: "weeklyDigest", label: "Weekly digest", description: "A Monday summary of every project's progress and budget." },
  { key: "mentions", label: "Mentions", description: "When someone mentions you in a comment or assigns you a task." },
  { key: "taskReminders", label: "Task reminders", description: "A nudge the morning a task you own is due." },
] as const;

export type NotificationKey = (typeof NOTIFICATION_SETTINGS)[number]["key"];
