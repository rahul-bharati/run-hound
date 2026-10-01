import { ACCOUNT_IDS, type AccountSource } from "../../types/accounts.js";
import { accountEnvName } from "../../config/accounts.js";
import type { AccountsStatus, AccountStatus } from "../../interfaces/accounts.js";

export function sourceWords(id: AccountStatus["id"], field: keyof AccountStatus["sources"], source: AccountSource): string {
  return source === "env" ? ` (env: ${accountEnvName(id, field)})` : ` (${source})`;
}

export function slotLines(s: AccountStatus): string[] {
  const from = (field: keyof AccountStatus["sources"], empty: boolean) =>
    empty && s.sources[field] === "default" ? "" : sourceWords(s.id, field, s.sources[field]);
  return [
    `${s.label} (${s.id}): ${s.ready ? "ready" : "not set up"}`,
    `  Sign-in page: ${s.loginUrl || "(none)"}${from("loginUrl", !s.loginUrl)}`,
    `  Username:     ${s.username || "(none)"}${from("username", !s.username)}`,
    `  Password:     ${s.hasPassword ? "saved" : "not saved"}${from("password", !s.hasPassword)}`,
    `  Label:        ${s.label}${from("label", false)}`,
    ...(s.problem ? [`  Problem: ${s.problem}`] : []),
  ];
}

export function accountsStatusText(status: AccountsStatus): string {
  const lines = ["Test accounts (for signed-in runs and the access checks):", ""];
  for (const id of ACCOUNT_IDS) lines.push(...slotLines(status.accounts[id]), "");
  lines.push(
    `A and B must not see each other's data (isolated): ${status.isolated ? "yes" : "no"} ${status.isolatedSource === "env" ? "(env: RUNHOUND_ACCOUNTS_ISOLATED)" : `(${status.isolatedSource})`}`,
  );
  lines.push(`Accounts file: ${status.file}`);
  return lines.join("\n");
}

export function accountsSetText(args: {
  savedStatus: AccountsStatus;
  before: AccountStatus;
  slotPasswordAdded: boolean;
}): string[] {
  const { savedStatus, before, slotPasswordAdded } = args;
  const slot = savedStatus.accounts[before.id];
  const lines = [`Saved ${slot.label} (${slot.id}) to ${savedStatus.file}.`, ...slotLines(slot).slice(1)];
  if (before.sources.password === "file" && !slotPasswordAdded && !slot.hasPassword) {
    lines.push(
      "The saved password was removed because the sign-in page moved to another site (origin). Save it again with --password-stdin.",
    );
  }
  const fromEnv = (Object.keys(slot.sources) as (keyof AccountStatus["sources"])[]).filter(
    (f) => slot.sources[f] === "env",
  );
  if (fromEnv.length) {
    const names = fromEnv.map((f) => accountEnvName(slot.id, f)).join(", ");
    lines.push(
      `${names} ${fromEnv.length === 1 ? "is" : "are"} set, and ${fromEnv.length === 1 ? "overrides" : "override"} the saved ${fromEnv.length === 1 ? "value" : "values"}.`,
    );
  }
  if (slot.ready) lines.push(`Check it with: run-hound accounts test ${slot.id}`);
  return lines;
}

export function accountsClearText(args: { label: string; id: AccountStatus["id"]; file: string; status: AccountStatus }): string[] {
  const lines = [`Removed ${args.label} (${args.id}) from ${args.file}.`];
  const fromEnv = (Object.keys(args.status.sources) as (keyof AccountStatus["sources"])[]).filter(
    (f) => args.status.sources[f] === "env",
  );
  if (fromEnv.length) {
    const names = fromEnv.map((f) => accountEnvName(args.id, f)).join(", ");
    lines.push(`${names} still ${fromEnv.length === 1 ? "sets" : "set"} it up from the environment.`);
  }
  return lines;
}
