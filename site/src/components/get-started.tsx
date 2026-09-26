import { CodeBlock } from "@/components/docs/code-block";
import { site } from "@/lib/site";

// The three ways to start, mirroring TESTING.md "Install": pull and run the published image (the main way, no clone),
// the test lab with the demo apps (one compose file), or a clone with pnpm (from source, for contributors).
const labInstall = `curl -fsSLO ${site.composeFileUrl}
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
 * "Start now" block: pull and run the image first (no clone, no build), then the test lab and the install from
 * source side by side, so a stranger can go from the page to a first run without asking anyone. Used on the homepage
 * and How it works.
 */
export function GetStarted() {
  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex min-w-0 flex-col gap-3">
        <h3 className="font-display text-xl font-bold tracking-tight">Docker or Podman: pull and run</h3>
        <p className="max-w-3xl text-[15px] leading-relaxed text-muted">
          No clone, no build: pull the image and run it from any folder. Open{" "}
          <code className={codeClass}>http://localhost:4000</code> and enter a page of an app on your machine as{" "}
          <code className={codeClass}>http://host.docker.internal:&lt;port&gt;/&lt;page&gt;</code>. Podman: the same
          with <code className={codeClass}>podman</code>. Reports land in <code className={codeClass}>./runs</code>.
        </p>
        <CodeBlock label="Run Hound, from any folder">{site.runCommands}</CodeBlock>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="font-display text-xl font-bold tracking-tight">Try it on the demo apps</h3>
          <p className="text-[15px] leading-relaxed text-muted">
            One compose file starts Run Hound with Kennel, Fernway and the sample apps. Open{" "}
            <code className={codeClass}>http://localhost:4000</code> and enter{" "}
            <code className={codeClass}>http://kennel:3000/book</code>.
          </p>
          <CodeBlock label="The test lab, from an empty folder">{labInstall}</CodeBlock>
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
        ) are public on GitHub&apos;s container registry, for linux/amd64 and arm64. Run Hound&apos;s alone is about
        260 MB to download; all four about 0.5 GB. <code className={codeClass}>docker pull</code> gets the latest
        release; the compose file comes from the {site.tag} release, so it always names the images of that release. MIT
        licensed, no sign-up, nothing to request.
      </p>
    </div>
  );
}
