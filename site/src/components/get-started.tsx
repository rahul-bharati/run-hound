import { CodeBlock } from "@/components/docs/code-block";
import { site } from "@/lib/site";

// The two ways to start, mirroring TESTING.md "Install": the published images with Docker/Podman (no clone), or a
// clone with pnpm (from source, for contributors and anyone who prefers Node).
const dockerInstall = `curl -fsSLO ${site.composeFileUrl}
mkdir -p runs                    # reports land in ./runs
docker compose -f run-hound.compose.yml up
# Podman: podman compose -f run-hound.compose.yml up`;

const sourceInstall = `git clone https://github.com/rahul-bharati/run-hound.git
cd run-hound
corepack enable                  # once, if pnpm isn't installed
pnpm install
pnpm --filter run-hound exec playwright install chromium
pnpm serve                       # web UI on http://localhost:4000`;

const codeClass = "font-mono text-[13px] text-fg [overflow-wrap:anywhere]";

/**
 * "Start now" block: both install paths side by side, Docker (no clone) first, so a stranger can go from the page
 * to a first run without asking anyone. Used on the homepage and How it works.
 */
export function GetStarted() {
  return (
    <div className="flex w-full flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="font-display text-xl font-bold tracking-tight">Docker or Podman</h3>
          <p className="text-[15px] leading-relaxed text-muted">
            No clone, no build: one file starts Run Hound with Kennel, Fernway and the sample apps from the published
            images. Open <code className={codeClass}>http://localhost:4000</code> and enter{" "}
            <code className={codeClass}>http://kennel:3000/book</code>.
          </p>
          <CodeBlock label="Run Hound and the test apps, from an empty folder">{dockerInstall}</CodeBlock>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="font-display text-xl font-bold tracking-tight">From source</h3>
          <p className="text-[15px] leading-relaxed text-muted">
            Node 22.12 or newer, pnpm and git; the way to contribute. It tests your own app with no networking set-up:
            enter <code className={codeClass}>http://localhost:&lt;port&gt;/&lt;page&gt;</code>.
          </p>
          <CodeBlock label="Clone and install">{sourceInstall}</CodeBlock>
        </div>
      </div>
      <p className="max-w-3xl text-sm leading-relaxed text-dim">
        The images (<code className={codeClass}>{site.image}</code>, with{" "}
        {site.labImages.map((name, i) => (
          <span key={name}>
            {i === 0 ? "" : i === site.labImages.length - 1 ? " and " : ", "}
            <code className={codeClass}>{name}</code>
          </span>
        ))}
        ) are public on GitHub&apos;s container registry, for linux/amd64 and arm64: about 0.5 GB to download for all
        four. The compose file comes from the {site.tag} release, so it always names the images of that release. MIT
        licensed, no sign-up, nothing to request.
      </p>
    </div>
  );
}
