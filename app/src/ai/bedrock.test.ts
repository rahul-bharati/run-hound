import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeLlm, type FakeLlm } from "../../test-support/fake-llm.js";
import { clearAwsCredentialCache } from "./aws-credentials.js";
import { converseJson } from "./bedrock.js";
import type { ChatMessage } from "./openai-compatible.js";
import { AiError } from "./types.js";

const SCHEMA = {
  name: "plan_review",
  schema: {
    type: "object",
    properties: { answer: { type: "number" } },
    required: ["answer"],
    additionalProperties: false,
  },
};
const MESSAGES: ChatMessage[] = [
  { role: "system", content: "You review test plans." },
  { role: "user", content: "Review this plan." },
];
const MODEL = "anthropic.claude-test-v1:0";
/** AWS's published example credentials (not real). */
const AWS_ENV = {
  AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
  AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

let fake: FakeLlm;
/** A temp home, so the real ~/.aws is never read. */
let home: string;
beforeEach(async () => {
  fake = await startFakeLlm();
  clearAwsCredentialCache();
  home = await mkdtemp(join(tmpdir(), "runhound-bedrock-"));
});
afterEach(async () => {
  await fake.close();
  await rm(home, { recursive: true, force: true });
});

const config = (overrides: Partial<{ apiKey: string | null; model: string; region: string | null; awsProfile: string | null }> = {}) => ({
  baseUrl: fake.url,
  model: MODEL,
  apiKey: "fake-bedrock-api-key" as string | null,
  region: "us-east-1",
  timeoutMs: 10_000,
  ...overrides,
});

async function caught(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    return error as AiError;
  }
  throw new Error("expected the call to reject");
}

describe("converseJson", () => {
  it("posts to /model/<encoded id>/converse and returns the tool input as JSON", async () => {
    fake.reply({ answer: 42 });
    const text = await converseJson(config(), MESSAGES, SCHEMA, undefined, {});
    expect(JSON.parse(text)).toEqual({ answer: 42 });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.path).toBe(`/model/${encodeURIComponent(MODEL)}/converse`);
    expect(fake.calls[0]!.path).toContain("%3A");
  });

  it("maps system messages to system and the rest to messages", async () => {
    fake.reply({ answer: 1 });
    await converseJson(config(), [...MESSAGES, { role: "assistant", content: "{}" }, { role: "user", content: "Again." }], SCHEMA, undefined, {});
    const body = fake.calls[0]!.body;
    expect(body.system).toEqual([{ text: "You review test plans." }]);
    expect(body.messages).toEqual([
      { role: "user", content: [{ text: "Review this plan." }] },
      { role: "assistant", content: [{ text: "{}" }] },
      { role: "user", content: [{ text: "Again." }] },
    ]);
  });

  it("forces one tool whose input schema is the answer schema, at temperature 0", async () => {
    fake.reply({ answer: 1 });
    await converseJson(config(), MESSAGES, SCHEMA, undefined, {});
    const body = fake.calls[0]!.body;
    expect(body.toolConfig.tools).toHaveLength(1);
    expect(body.toolConfig.tools[0].toolSpec).toMatchObject({ name: "plan_review", inputSchema: { json: SCHEMA.schema } });
    expect(typeof body.toolConfig.tools[0].toolSpec.description).toBe("string");
    expect(body.toolConfig.toolChoice).toEqual({ tool: { name: "plan_review" } });
    expect(body.inferenceConfig).toMatchObject({ temperature: 0 });
  });

  it("sends a Bedrock API key as a Bearer token", async () => {
    fake.reply({ answer: 1 });
    await converseJson(config(), MESSAGES, SCHEMA, undefined, AWS_ENV);
    expect(fake.calls[0]!.headers.authorization).toBe("Bearer fake-bedrock-api-key");
  });

  it("signs with SigV4 from the AWS env keys when there is no API key", async () => {
    fake.reply({ answer: 1 });
    await converseJson(config({ apiKey: null }), MESSAGES, SCHEMA, undefined, { ...AWS_ENV, AWS_SESSION_TOKEN: "FAKE-session-token" });
    const headers = fake.calls[0]!.headers;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/bedrock\/aws4_request, ?SignedHeaders=/);
    expect(headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers["x-amz-security-token"]).toBe("FAKE-session-token");
  });

  it("rejects with auth and sends nothing when there are no credentials", async () => {
    fake.reply({ answer: 1 });
    const error = await caught(converseJson(config({ apiKey: null }), MESSAGES, SCHEMA, undefined, {}, { home }));
    expect(error.code).toBe("auth");
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a region that is not an AWS region name and sends nothing", async () => {
    fake.reply({ answer: 1 });
    for (const region of ["x@evil.com/", "evil.com#", "us-east-1.evil.com"]) {
      const error = await caught(converseJson(config({ region, apiKey: "key" }), MESSAGES, SCHEMA, undefined, {}, { home }));
      expect(error.code).toBe("not-configured");
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("signs with the keys of the AWS profile when there is no API key and no env keys", async () => {
    await mkdir(join(home, ".aws"), { recursive: true });
    await writeFile(join(home, ".aws", "credentials"), `[work]\naws_access_key_id = AKIDPROFILE\naws_secret_access_key = profile-secret\naws_session_token = profile-token\n`);
    fake.reply({ answer: 1 });
    await converseJson(config({ apiKey: null, awsProfile: "work" }), MESSAGES, SCHEMA, undefined, {}, { home });
    const headers = fake.calls[0]!.headers;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDPROFILE\/\d{8}\/us-east-1\/bedrock\/aws4_request/);
    expect(headers["x-amz-security-token"]).toBe("profile-token");
  });

  it("takes the region from the AWS profile when none is set", async () => {
    await mkdir(join(home, ".aws"), { recursive: true });
    await writeFile(join(home, ".aws", "config"), `[profile work]\nregion = eu-central-1\naws_access_key_id = AKIDPROFILE\naws_secret_access_key = profile-secret\n`);
    fake.reply({ answer: 1 });
    await converseJson(config({ apiKey: null, region: null, awsProfile: "work" }), MESSAGES, SCHEMA, undefined, {}, { home });
    expect(fake.calls[0]!.headers.authorization).toMatch(/\/eu-central-1\/bedrock\//);
  });

  it("rejects with auth on a 403", async () => {
    fake.reply({ status: 403, body: JSON.stringify({ message: "The security token included in the request is invalid." }) });
    const error = await caught(converseJson(config(), MESSAGES, SCHEMA, undefined, {}));
    expect(error.code).toBe("auth");
    expect(error.status).toBe(403);
  });

  it("says to choose a model that supports tool use when the model can't", async () => {
    fake.reply({ status: 400, body: JSON.stringify({ message: "This model doesn't support tool use." }) });
    const error = await caught(converseJson(config(), MESSAGES, SCHEMA, undefined, {}));
    expect(error.code).toBe("http");
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/model that supports tool use/i);
  });
});
