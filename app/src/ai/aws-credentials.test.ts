import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { json, startFixtureServer, type FixtureServer } from "../../test-support/server.js";
import {
  awsCredentialsAvailable,
  awsProfileName,
  awsProfileRegion,
  clearAwsCredentialCache,
  parseAwsIni,
  resolveAwsCredentials,
} from "./aws-credentials.js";
import { AiError } from "./types.js";

/** AWS's published example credentials (not real). */
const KEY_ID = "AKIAIOSFODNN7EXAMPLE";
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

let home: string;
beforeEach(async () => {
  clearAwsCredentialCache();
  home = await mkdtemp(join(tmpdir(), "runhound-aws-"));
  await mkdir(join(home, ".aws", "sso", "cache"), { recursive: true });
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const aws = (name: string) => join(home, ".aws", name);
const sha1 = (s: string) => createHash("sha1").update(s, "utf8").digest("hex");

async function caught(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    return error as AiError;
  }
  throw new Error("expected the call to reject");
}

async function writeToken(name: string, expiresAt: Date, accessToken = "fake-sso-access-token"): Promise<void> {
  await writeFile(join(home, ".aws", "sso", "cache", `${sha1(name)}.json`), JSON.stringify({ accessToken, expiresAt: expiresAt.toISOString(), region: "eu-west-1" }));
}

describe("parseAwsIni", () => {
  it("reads sections and settings, ignoring comments, blank lines and nested settings", () => {
    const text = [
      "# comment",
      "; another comment",
      "[default]",
      "region = us-east-1 # trailing comment",
      "",
      "[profile dev]",
      "aws_access_key_id=AKID",
      "s3 =",
      "    max_concurrent_requests = 10",
      "Output = json",
      "[sso-session corp]",
      "sso_start_url = https://corp.awsapps.com/start",
    ].join("\n");
    expect(parseAwsIni(text)).toEqual({
      default: { region: "us-east-1" },
      "profile dev": { aws_access_key_id: "AKID", s3: "", output: "json" },
      "sso-session corp": { sso_start_url: "https://corp.awsapps.com/start" },
    });
  });
});

describe("awsProfileName", () => {
  it("prefers the configured profile, then AWS_PROFILE, then default", () => {
    expect(awsProfileName({ AWS_PROFILE: "env" }, "configured")).toBe("configured");
    expect(awsProfileName({ AWS_PROFILE: "env" }, null)).toBe("env");
    expect(awsProfileName({}, undefined)).toBe("default");
  });
});

describe("resolveAwsCredentials", () => {
  it("uses the env keys first", async () => {
    await writeFile(aws("credentials"), `[default]\naws_access_key_id = FROMFILE\naws_secret_access_key = x\n`);
    const r = await resolveAwsCredentials({ env: { AWS_ACCESS_KEY_ID: KEY_ID, AWS_SECRET_ACCESS_KEY: SECRET, AWS_SESSION_TOKEN: "tok" }, home });
    expect(r.credentials).toEqual({ accessKeyId: KEY_ID, secretAccessKey: SECRET, sessionToken: "tok" });
    expect(r.source).toBe("env");
  });

  it("reads static keys of the default profile from ~/.aws/credentials", async () => {
    await writeFile(aws("credentials"), `[default]\naws_access_key_id = ${KEY_ID}\naws_secret_access_key = ${SECRET}\n`);
    const r = await resolveAwsCredentials({ env: {}, home });
    expect(r.credentials).toEqual({ accessKeyId: KEY_ID, secretAccessKey: SECRET });
    expect(r.source).toBe("profile");
  });

  it("uses AWS_PROFILE and [profile x] sections of ~/.aws/config; the credentials file wins for the same profile", async () => {
    await writeFile(aws("config"), `[profile work]\naws_access_key_id = FROMCONFIG\naws_secret_access_key = config-secret\n[profile other]\naws_access_key_id = OTHER\naws_secret_access_key = other\n`);
    let r = await resolveAwsCredentials({ env: { AWS_PROFILE: "other" }, home });
    expect(r.credentials.accessKeyId).toBe("OTHER");
    await writeFile(aws("credentials"), `[work]\naws_access_key_id = FROMCREDS\naws_secret_access_key = creds-secret\naws_session_token = sess\n`);
    r = await resolveAwsCredentials({ env: { AWS_PROFILE: "work" }, home });
    expect(r.credentials).toEqual({ accessKeyId: "FROMCREDS", secretAccessKey: "creds-secret", sessionToken: "sess" });
  });

  it("lets the configured profile win over AWS_PROFILE", async () => {
    await writeFile(aws("credentials"), `[a]\naws_access_key_id = A\naws_secret_access_key = a\n[b]\naws_access_key_id = B\naws_secret_access_key = b\n`);
    const r = await resolveAwsCredentials({ env: { AWS_PROFILE: "a" }, home, profile: "b" });
    expect(r.credentials.accessKeyId).toBe("B");
  });

  it("honours AWS_SHARED_CREDENTIALS_FILE and AWS_CONFIG_FILE", async () => {
    await writeFile(join(home, "creds.ini"), `[default]\naws_access_key_id = ELSEWHERE\naws_secret_access_key = x\n`);
    await writeFile(join(home, "config.ini"), `[profile p]\naws_access_key_id = CONFIGELSEWHERE\naws_secret_access_key = y\n`);
    expect((await resolveAwsCredentials({ env: { AWS_SHARED_CREDENTIALS_FILE: join(home, "creds.ini") }, home })).credentials.accessKeyId).toBe("ELSEWHERE");
    expect((await resolveAwsCredentials({ env: { AWS_CONFIG_FILE: join(home, "config.ini") }, home, profile: "p" })).credentials.accessKeyId).toBe("CONFIGELSEWHERE");
  });

  it("rejects with auth when nothing is configured", async () => {
    const error = await caught(resolveAwsCredentials({ env: {}, home }));
    expect(error.code).toBe("auth");
  });

  it("says a named profile was not found", async () => {
    await writeFile(aws("config"), `[default]\nregion = us-east-1\n`);
    const error = await caught(resolveAwsCredentials({ env: {}, home, profile: "missing" }));
    expect(error.message).toMatch(/missing/);
    expect(error.message).toMatch(/not found/i);
  });

  it("refuses assume-role profiles with a clear message", async () => {
    await writeFile(aws("config"), `[profile role]\nrole_arn = arn:aws:iam::123456789012:role/r\nsource_profile = default\n`);
    const error = await caught(resolveAwsCredentials({ env: {}, home, profile: "role" }));
    expect(error.message).toMatch(/role_arn/);
    expect(error.message).toMatch(/not supported/i);
  });

  describe("credential_process", () => {
    async function processProfile(output: object, exitCode = 0): Promise<string> {
      const script = join(home, "creds.mjs");
      const counter = join(home, "count.txt");
      await writeFile(
        script,
        `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(counter)}, "x");\nprocess.stdout.write(${JSON.stringify(JSON.stringify(output))});\nprocess.exit(${exitCode});\n`,
      );
      await writeFile(aws("config"), `[profile proc]\ncredential_process = "${process.execPath}" "${script}" --flag\n`);
      return counter;
    }

    it("runs the command and reads the Version 1 JSON", async () => {
      const expiration = new Date(Date.now() + 3600_000).toISOString();
      await processProfile({ Version: 1, AccessKeyId: "PROC", SecretAccessKey: "proc-secret", SessionToken: "proc-token", Expiration: expiration });
      const r = await resolveAwsCredentials({ env: {}, home, profile: "proc" });
      expect(r.credentials).toEqual({ accessKeyId: "PROC", secretAccessKey: "proc-secret", sessionToken: "proc-token" });
      expect(r.expiration).toBe(Date.parse(expiration));
      expect(r.source).toBe("process");
    });

    it("caches temporary credentials until 5 minutes before they expire", async () => {
      const counter = await processProfile({ Version: 1, AccessKeyId: "PROC", SecretAccessKey: "s", SessionToken: "t", Expiration: new Date(Date.now() + 3600_000).toISOString() });
      await resolveAwsCredentials({ env: {}, home, profile: "proc" });
      await resolveAwsCredentials({ env: {}, home, profile: "proc" });
      expect(await readFile(counter, "utf8")).toBe("x");
      await resolveAwsCredentials({ env: {}, home, profile: "proc", now: Date.now() + 3600_000 - 4 * 60_000 });
      expect(await readFile(counter, "utf8")).toBe("xx");
    });

    it("rejects a wrong Version or a failing command", async () => {
      await processProfile({ Version: 2, AccessKeyId: "PROC", SecretAccessKey: "s" });
      expect((await caught(resolveAwsCredentials({ env: {}, home, profile: "proc" }))).code).toBe("auth");
      clearAwsCredentialCache();
      await processProfile({ Version: 1, AccessKeyId: "PROC", SecretAccessKey: "s" }, 3);
      expect((await caught(resolveAwsCredentials({ env: {}, home, profile: "proc" }))).code).toBe("auth");
    });
  });

  describe("IAM Identity Center (SSO)", () => {
    let portal: FixtureServer;
    let expiration: number;
    beforeEach(async () => {
      expiration = Date.now() + 3600_000;
      portal = await startFixtureServer({
        routes: {
          "GET /federation/credentials": (req, res) => {
            if (req.headers["x-amz-sso_bearer_token"] !== "fake-sso-access-token") return json(res, 401, { message: "Session token not found or invalid" });
            json(res, 200, { roleCredentials: { accessKeyId: "SSOKEY", secretAccessKey: "sso-secret", sessionToken: "sso-token", expiration } });
          },
        },
      });
    });
    afterEach(async () => {
      await portal.close();
    });

    const SESSION_CONFIG = `[profile dev]\nsso_session = corp\nsso_account_id = 111122223333\nsso_role_name = SampleRole\nregion = eu-central-1\n\n[sso-session corp]\nsso_region = us-east-1\nsso_start_url = https://corp.awsapps.com/start\n`;

    it("exchanges the cached sso-session token for role credentials", async () => {
      await writeFile(aws("config"), SESSION_CONFIG);
      await writeToken("corp", new Date(Date.now() + 3600_000));
      const r = await resolveAwsCredentials({ env: {}, home, profile: "dev", ssoPortalUrl: portal.url });
      expect(r.credentials).toEqual({ accessKeyId: "SSOKEY", secretAccessKey: "sso-secret", sessionToken: "sso-token" });
      expect(r.expiration).toBe(expiration);
      expect(r.source).toBe("sso");
      const url = new URL(portal.requests[0]!.url, "http://x");
      expect(url.searchParams.get("account_id")).toBe("111122223333");
      expect(url.searchParams.get("role_name")).toBe("SampleRole");
    });

    it("caches the role credentials", async () => {
      await writeFile(aws("config"), SESSION_CONFIG);
      await writeToken("corp", new Date(Date.now() + 3600_000));
      await resolveAwsCredentials({ env: {}, home, profile: "dev", ssoPortalUrl: portal.url });
      await resolveAwsCredentials({ env: {}, home, profile: "dev", ssoPortalUrl: portal.url });
      expect(portal.requests).toHaveLength(1);
    });

    it("uses the start URL's hash for legacy profiles", async () => {
      await writeFile(aws("config"), `[profile legacy]\nsso_start_url = https://legacy.awsapps.com/start\nsso_region = us-west-2\nsso_account_id = 111122223333\nsso_role_name = ReadOnly\n`);
      await writeToken("https://legacy.awsapps.com/start", new Date(Date.now() + 3600_000));
      const r = await resolveAwsCredentials({ env: {}, home, profile: "legacy", ssoPortalUrl: portal.url });
      expect(r.credentials.accessKeyId).toBe("SSOKEY");
    });

    it("tells the user to run aws sso login when the token expired or is missing", async () => {
      await writeFile(aws("config"), SESSION_CONFIG);
      let error = await caught(resolveAwsCredentials({ env: {}, home, profile: "dev", ssoPortalUrl: portal.url }));
      expect(error.code).toBe("auth");
      expect(error.message).toContain("aws sso login --profile dev");
      await writeToken("corp", new Date(Date.now() - 60_000));
      error = await caught(resolveAwsCredentials({ env: {}, home, profile: "dev", ssoPortalUrl: portal.url }));
      expect(error.code).toBe("auth");
      expect(error.message).toContain("aws sso login --profile dev");
      expect(portal.requests).toHaveLength(0);
    });

    it("tells the user to log in again when the portal refuses the token", async () => {
      await writeFile(aws("config"), SESSION_CONFIG);
      await writeToken("corp", new Date(Date.now() + 3600_000), "revoked-token");
      const error = await caught(resolveAwsCredentials({ env: {}, home, profile: "dev", ssoPortalUrl: portal.url }));
      expect(error.code).toBe("auth");
      expect(error.message).toContain("aws sso login --profile dev");
      expect(error.message).not.toContain("revoked-token");
    });
  });
});

describe("awsProfileRegion", () => {
  it("reads the region of the profile from the config file", async () => {
    await writeFile(aws("config"), `[default]\nregion = us-west-2\n[profile dev]\nregion = eu-central-1\n`);
    expect(awsProfileRegion({ env: {}, home })).toBe("us-west-2");
    expect(awsProfileRegion({ env: { AWS_PROFILE: "dev" }, home })).toBe("eu-central-1");
    expect(awsProfileRegion({ env: {}, home, profile: "none" })).toBeNull();
  });
});

describe("awsCredentialsAvailable", () => {
  it("is false when nothing in the chain is set", () => {
    expect(awsCredentialsAvailable({ env: {}, home })).toBe(false);
  });

  it("is true for env keys, static profile keys and credential_process", async () => {
    expect(awsCredentialsAvailable({ env: { AWS_ACCESS_KEY_ID: KEY_ID, AWS_SECRET_ACCESS_KEY: SECRET }, home })).toBe(true);
    await writeFile(aws("config"), `[profile proc]\ncredential_process = /usr/bin/false\n`);
    expect(awsCredentialsAvailable({ env: {}, home, profile: "proc" })).toBe(true);
    await writeFile(aws("credentials"), `[default]\naws_access_key_id = ${KEY_ID}\naws_secret_access_key = ${SECRET}\n`);
    expect(awsCredentialsAvailable({ env: {}, home })).toBe(true);
  });

  it("is true for an SSO profile only when a cached token file exists (without calling SSO)", async () => {
    await writeFile(aws("config"), `[profile dev]\nsso_session = corp\nsso_account_id = 1\nsso_role_name = R\n[sso-session corp]\nsso_region = us-east-1\nsso_start_url = https://corp.awsapps.com/start\n`);
    expect(awsCredentialsAvailable({ env: {}, home, profile: "dev" })).toBe(false);
    await writeToken("corp", new Date(Date.now() + 3600_000));
    expect(awsCredentialsAvailable({ env: {}, home, profile: "dev" })).toBe(true);
  });
});
