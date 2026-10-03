/**
 * The AI API and Bedrock access keys (0.6.1, docs/launch-spec.md "Bedrock credentials", "API"):
 * - PUT /api/ai accepts awsAccessKeyId + awsSecretAccessKey (+ awsSessionToken); they are write-only: neither the PUT
 *   answer, a later GET /api/ai nor GET /api/settings contains any of them (hasAwsKeys, hasAwsSessionToken and
 *   sources.awsKeys say what is set); they are saved in ai.json, mode 0600;
 * - half a pair is a 400 that saves nothing; a pair set by AWS_ACCESS_KEY_ID is locked (400 naming it); an error never
 *   echoes a value;
 * - with no profile named, the server reads nothing from ~/.aws: HOME points at a sentinel home whose [default] profile
 *   has keys and a region, and neither shows up in the status.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearAwsCredentialCache } from "../../../src/ai/aws-credentials.js";
import type { AiStatus } from "../../../src/ai/types.js";
import type { Check } from "../../../src/core/types.js";
import { createApp } from "../../../src/server/app.js";

const ID = "AKIAIOSFODNN7SAVED01";
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYSAVEDKEY01";
const TOKEN = "FwoGZXIvYXdzESAVEDTOKEN0123456789";
const RH = { "x-run-hound": "1" };
/** Variables these tests set or that a developer's shell may hold and that would change the answers. */
const TOUCHED = ["HOME", "RUNHOUND_CONFIG_DIR", "XDG_CONFIG_HOME", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE", "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_BEARER_TOKEN_BEDROCK", "AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE"];
const checks: Check[] = [];

let tmp: string;
let configDir: string;
let saved: Record<string, string | undefined>;
let app: Hono;

beforeEach(async () => {
  clearAwsCredentialCache();
  saved = {};
  for (const name of [...TOUCHED, ...Object.keys(process.env).filter((k) => k.startsWith("RUNHOUND_AI"))]) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  tmp = await mkdtemp(join(tmpdir(), "rh-ai-credentials-"));
  configDir = join(tmp, "config");
  const home = join(tmp, "home");
  await mkdir(join(home, ".aws"), { recursive: true });
  await writeFile(join(home, ".aws", "credentials"), "[default]\naws_access_key_id = AKIADEFAULTSENTINEL1\naws_secret_access_key = default-secret\n[work]\naws_access_key_id = AKIAWORKPROFILE00001\naws_secret_access_key = work-secret\n");
  await writeFile(join(home, ".aws", "config"), "[default]\nregion = ap-southeast-2\n");
  process.env.HOME = home;
  process.env.RUNHOUND_CONFIG_DIR = configDir;
  app = createApp({ checks, canShowBrowser: false, maxConcurrentRuns: 1 });
});

afterEach(async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith("RUNHOUND_AI")) delete process.env[k];
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(tmp, { recursive: true, force: true });
});

function put(body: unknown) {
  return app.request("/api/ai", { method: "PUT", headers: { "content-type": "application/json", ...RH }, body: JSON.stringify(body) });
}
const get = (path: string) => app.request(path, { headers: RH });

function expectNoSecret(text: string): void {
  for (const value of [ID, SECRET, TOKEN]) expect(text).not.toContain(value);
  for (const field of ["awsAccessKeyId", "awsSecretAccessKey", "awsSessionToken"]) expect(text).not.toContain(`"${field}"`);
}

const BEDROCK = { enabled: true, provider: "bedrock", model: "anthropic.claude-test", region: "us-east-1" };

describe("PUT /api/ai with AWS access keys", () => {
  it("saves the pair and token; the answer, GET /api/ai and GET /api/settings carry none of them", async () => {
    const res = await put({ ...BEDROCK, awsAccessKeyId: ID, awsSecretAccessKey: SECRET, awsSessionToken: TOKEN });
    expect(res.status).toBe(200);
    const text = await res.text();
    expectNoSecret(text);
    const status = JSON.parse(text) as AiStatus;
    expect(status).toMatchObject({ hasAwsKeys: true, hasAwsSessionToken: true, hasKey: true });
    expect(status.sources.awsKeys).toBe("file");

    const again = await (await get("/api/ai")).text();
    expectNoSecret(again);
    expect(JSON.parse(again) as AiStatus).toMatchObject({ hasAwsKeys: true, hasAwsSessionToken: true });
    expectNoSecret(await (await get("/api/settings")).text());

    const file = join(configDir, "ai.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ awsAccessKeyId: ID, awsSecretAccessKey: SECRET, awsSessionToken: TOKEN });
  });

  it("answers 400 to half a pair and saves nothing, without echoing the value", async () => {
    const res = await put({ ...BEDROCK, awsSecretAccessKey: SECRET });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const status = (await (await get("/api/ai")).json()) as AiStatus;
    expect(status.hasAwsKeys).toBe(false);
    expect(status.enabled).toBe(false);
  });

  it("refuses to change a pair set by AWS_ACCESS_KEY_ID (400 naming it) and shows it as set from env, without the values", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7ENVKEY1";
    process.env.AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYENVKEY0001";
    expect((await put(BEDROCK)).status).toBe(200);
    const res = await put({ awsAccessKeyId: ID, awsSecretAccessKey: SECRET });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("AWS_ACCESS_KEY_ID");
    expect(body.error).not.toContain(SECRET);
    const text = await (await get("/api/ai")).text();
    expect(text).not.toContain("AKIAIOSFODNN7ENVKEY1");
    expect(text).not.toContain("wJalrXUtnFEMI/K7MDENG/bPxRfiCYENVKEY0001");
    const status = JSON.parse(text) as AiStatus;
    expect(status.hasAwsKeys).toBe(true);
    expect(status.sources.awsKeys).toBe("env");
  });
});

describe("GET /api/ai and ~/.aws", () => {
  it("reads no region and no credentials from a [default] profile when no profile is named", async () => {
    expect((await put({ enabled: true, provider: "bedrock", model: "anthropic.claude-test" })).status).toBe(200);
    let status = (await (await get("/api/ai")).json()) as AiStatus;
    expect(status.region).toBeNull();
    expect(status.problem).toBe("Choose a Bedrock region");
    expect((await put({ region: "us-east-1" })).status).toBe(200);
    status = (await (await get("/api/ai")).json()) as AiStatus;
    expect(status.hasKey).toBe(false);
    expect(status.problem).toBe("Bedrock needs credentials: an API key, AWS access keys or an AWS profile");
  });

  it("uses a profile once one is named", async () => {
    expect((await put({ ...BEDROCK, awsProfile: "work" })).status).toBe(200);
    const status = (await (await get("/api/ai")).json()) as AiStatus;
    expect(status.hasKey).toBe(true);
    expect(status.awsProfile).toBe("work");
  });
});
