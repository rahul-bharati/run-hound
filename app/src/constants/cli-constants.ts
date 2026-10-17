export const USAGE = `Usage:
  run-hound serve [--port 4000] [--host 127.0.0.1] [--runs-dir <dir>]
      Web UI and API. Open the printed address, enter your form's URL, approve the plan and watch the run.
  run-hound run <url> [options]
      Plan and run the checks against a form on your local app, e.g. http://localhost:5173/signup.
      --approve all|default|<id,id>   which scenarios to run (default: the recommended ones)
      --plan-only                     list the planned scenarios and their ids, then stop
      --allow-destructive             also run scenarios that may change or delete data
      --headed                        open a visible browser window so you can watch the run
      --runs-dir <dir>                where run folders go (default: ./runs)
      --json                          print the report (or the plan) as JSON on stdout
      --ai / --no-ai                  use the AI model to review the plan, suggest flows and explain findings
                                      (off unless turned on here, in Settings or with RUNHOUND_AI=1)
      --ai-provider <name>            anthropic, openai, gemini, bedrock, openai-compatible or ollama
      --ai-model <id>                 model id as the provider names it, e.g. claude-haiku-4-5
      --ai-base-url <url>             e.g. http://127.0.0.1:11434/v1
      --ai-allow-remote               consent to send redacted page structure to a non-local endpoint
      --as a|b                        sign in as test account A or B first and run every check signed in
                                      (set the accounts up with "accounts set" or in Settings → Test accounts)
  run-hound ai status | ai test [--ai-provider … --ai-model … --ai-base-url … --ai-allow-remote]
      Show the AI settings (never the key), or check that the model answers.
  run-hound accounts status | accounts test [a|b] | accounts clear a|b
  run-hound accounts set a|b [--login-url <url>] [--username <name>] [--label <text>] [--password-stdin]
      Two test accounts you own on your app (A and B), for signed-in runs and the access checks. The password is read
      from stdin, never from a flag: typed after a prompt, or piped:
        printf '%s\\n' "$PASSWORD" | run-hound accounts set a --password-stdin
      "accounts test" signs in and says where it landed. RUNHOUND_ACCOUNT_A_LOGIN_URL, …_USERNAME, …_PASSWORD,
      …_LABEL (and _B_) override the saved values.
  run-hound help | --version

Exit codes for run:
  0  no confirmed findings (advisory findings, which rely on judgement, are reported but don't fail the run)
  1  at least one confirmed finding
  2  an error: a refused or unreachable target, no form found, bad arguments, --ai when AI can't be used, or --as with
     an account that isn't set up or can't sign in; or a run where nothing was tested because every approved
     scenario errored or was skipped

Run Hound only tests local and private-network addresses (localhost, 127.0.0.1, 10.x, 172.16-31.x, 192.168.x,
fc00::/7, link-local); add other hosts you own to RUNHOUND_ALLOWED_HOSTS. Scenarios that submit the form create
test records in your app; the report says how many. Run Hound does not delete them.`;

