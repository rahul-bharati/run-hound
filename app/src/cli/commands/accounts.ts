import { parseArgs } from "node:util";
import { USAGE } from "../../constants/cli-constants.js";
import { UsageError } from "../../errors/usage-error.js";
import { parseArgsWithError } from "../../utils/parse-args-with-errors.js";
import { ACCOUNTS_OPTIONS } from "../../config/cli.js";
import { ACCOUNT_IDS } from "../../types/accounts.js";
import { isAccountId } from "../../server/accounts.js";
import { redactSecrets } from "../../engine/redact.js";
import { accountsSetText, accountsClearText, accountsStatusText } from "../presenters/accounts.js";
import type { IAccountsCommandDeps } from "../../interfaces/cli.js";
import type { AccountsPatch, AccountStatus } from "../../interfaces/accounts.js";

export async function accountsCommand(args: string[], deps: IAccountsCommandDeps): Promise<number> {
  const { values, positionals } = parseArgsWithError(() =>
    parseArgs({ args, allowPositionals: true, options: ACCOUNTS_OPTIONS }),
  );
  const v = values;
  if (v.help) {
    deps.context.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (v.password !== undefined) {
    throw new UsageError(
      "--password is not accepted: a password on the command line stays in your shell history. Use --password-stdin and type or pipe it instead; nothing was saved.",
    );
  }
  const [sub, slot, ...extra] = positionals;
  const setOptions =
    v["login-url"] !== undefined || v.username !== undefined || v.label !== undefined || v["password-stdin"];
  if (sub !== "set" && setOptions)
    throw new UsageError('--login-url, --username, --label and --password-stdin go with "accounts set a|b"');
  if (extra.length) throw new UsageError(`unexpected argument: ${extra[0]!.slice(0, 40)}`);
  const slotId = (what: string, optional = false): AccountStatus["id"] | undefined => {
    if (slot === undefined && optional) return undefined;
    if (isAccountId(slot)) return slot;
    throw new UsageError(
      slot === undefined
        ? `accounts ${what} needs the account: a or b`
        : `accounts ${what} takes a or b (the test account), not "${slot.slice(0, 20)}"`,
    );
  };
  const safety = {
    allowedHosts: deps.allowedHosts(),
  };

  if (sub === "status") {
    if (slot !== undefined) throw new UsageError(`unexpected argument: ${slot.slice(0, 40)}`);
    deps.context.stdout.write(
      `${redactSecrets(accountsStatusText((await deps.services.resolveAccounts()).status))}\n`,
    );
    return 0;
  }

  if (sub === "test") {
    const only = slotId("test", true);
    const resolved = await deps.services.resolveAccounts();
    let allOk = true;
    for (const id of only ? [only] : ACCOUNT_IDS) {
      const result = await deps.services.testSignIn(id, resolved, safety);
      const label = resolved.status.accounts[id].label;
      const message = result.message.includes(label) ? result.message : `${label}: ${result.message}`;
      if (result.ok) deps.context.stdout.write(`${redactSecrets(message)}\n`);
      else {
        allOk = false;
        deps.context.stderr.write(`run-hound: ${redactSecrets(message)}\n`);
      }
    }
    return allOk ? 0 : 2;
  }

  if (sub === "set") {
    const id = slotId("set")!;
    if (!setOptions)
      throw new UsageError(
        "accounts set needs at least one of --login-url, --username, --label or --password-stdin",
      );
    const slotPatch: NonNullable<AccountsPatch["accounts"]>[AccountStatus["id"]] = {};
    if (v["login-url"] !== undefined) slotPatch.loginUrl = v["login-url"];
    if (v.username !== undefined) slotPatch.username = v.username;
    if (v.label !== undefined) slotPatch.label = v.label;
    const patch: AccountsPatch = { accounts: { [id]: slotPatch } };
    deps.services.checkAccountsPatch(patch);
    const before = await deps.services.resolveAccounts();
    await deps.services.checkLoginUrls(patch, before.status, safety);
    if (v["password-stdin"])
      slotPatch.password = await deps.readPassword(
        slotPatch.label?.trim() || before.status.accounts[id].label,
      );
    const unregister = slotPatch.password
      ? deps.services.registerPasswords(
          {
            ...before.config,
            accounts: {
              ...before.config.accounts,
              [id]: {
                ...before.config.accounts[id],
                password: slotPatch.password,
              },
            },
          },
          [id],
        )
      : () => undefined;
    try {
      const status = await deps.services.saveAccounts(patch);
      const lines = accountsSetText({
        savedStatus: status,
        before: before.status.accounts[id],
        slotPasswordAdded: Boolean(slotPatch.password),
      });
      deps.context.stdout.write(`${redactSecrets(lines.join("\n"))}\n`);
      return 0;
    } finally {
      unregister();
    }
  }

  if (sub === "clear") {
    const id = slotId("clear")!;
    const before = await deps.services.resolveAccounts();
    const label = before.status.accounts[id].label;
    const status = await deps.services.clearAccount(id);
    const s = status.accounts[id];
    const lines = accountsClearText({ label, id, file: status.file, status: s });
    deps.context.stdout.write(`${redactSecrets(lines.join("\n"))}\n`);
    return 0;
  }

  throw new UsageError(
    sub
      ? `unknown accounts command: ${sub.slice(0, 40)} (use "accounts status", "accounts test", "accounts set" or "accounts clear")`
      : 'accounts needs a command: "accounts status", "accounts test", "accounts set" or "accounts clear"',
  );
}
