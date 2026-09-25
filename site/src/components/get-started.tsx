import { CodeBlock } from "@/components/docs/code-block";
import { site } from "@/lib/site";

// The two ways to start, mirroring TESTING.md "Install": a local clone with pnpm, or Docker/Podman with the test apps.
const localInstall = `git clone https://github.com/rahul-bharati/run-hound.git
cd run-hound
corepack enable                  # once, if pnpm isn't installed
pnpm install
pnpm --filter run-hound exec playwright install chromium
pnpm serve                       # web UI on http://localhost:4000`;

const dockerInstall = `git clone https://github.com/rahul-bharati/run-hound.git
cd run-hound
cp .env.example .env && mkdir -p runs
docker compose up --build        # or: podman compose up --build`;

const codeClass = "font-mono text-[13px] text-fg [overflow-wrap:anywhere]";

/**
 * "Start now" block: both install paths side by side, so a stranger can go from the page to a first run without
 * asking anyone. Used on the homepage and How it works.
 */
export function GetStarted() {
  return (
    <div className="flex w-full flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="font-display text-xl font-bold tracking-tight">Local install</h3>
          <p className="text-[15px] leading-relaxed text-muted">
            Node 22 or newer, pnpm and git. The simplest way to test your own app: enter{" "}
            <code className={codeClass}>http://localhost:&lt;port&gt;/&lt;page&gt;</code>.
          </p>
          <CodeBlock label="Clone and install">{localInstall}</CodeBlock>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="font-display text-xl font-bold tracking-tight">Docker or Podman</h3>
          <p className="text-[15px] leading-relaxed text-muted">
            One command starts Run Hound with Kennel and the sample apps. Open{" "}
            <code className={codeClass}>http://localhost:4000</code> and enter{" "}
            <code className={codeClass}>http://kennel:3000/book</code>.
          </p>
          <CodeBlock label="Run Hound and the test apps">{dockerInstall}</CodeBlock>
        </div>
      </div>
      <p className="max-w-3xl text-sm leading-relaxed text-dim">
        Images are published to GitHub&apos;s registry on release as <code className={codeClass}>{site.image}</code>{" "}
        (with <code className={codeClass}>run-hound-kennel</code> and <code className={codeClass}>run-hound-samples</code>): use{" "}
        <code className={codeClass}>docker compose pull &amp;&amp; docker compose up</code> instead of building. If an
        image isn&apos;t published yet, <code className={codeClass}>docker compose build</code> builds it from the
        clone. MIT licensed, no sign-up, nothing to request.
      </p>
    </div>
  );
}
