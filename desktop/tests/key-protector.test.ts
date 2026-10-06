import { describe, expect, it } from "vitest";
import { osKeyProtector, type SafeStorageLike } from "../src/key-protector.js";

/**
 * A stand-in for Electron's safeStorage: "encrypts" by reversing the text and tagging it, and refuses what it didn't
 * encrypt. `backend` undefined models a platform whose safeStorage has no getSelectedStorageBackend (macOS, Windows).
 */
function fakeStorage(options: { available?: boolean; backend?: string | "absent" } = {}): SafeStorageLike {
  const storage: SafeStorageLike = {
    isEncryptionAvailable: () => options.available ?? true,
    encryptString: (plain) => Buffer.from(`enc:${[...plain].reverse().join("")}`, "utf8"),
    decryptString: (encrypted) => {
      const text = encrypted.toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("not encrypted by this store");
      return [...text.slice(4)].reverse().join("");
    },
  };
  if (options.backend !== "absent" && options.backend !== undefined) storage.getSelectedStorageBackend = () => options.backend as string;
  return storage;
}

describe("osKeyProtector", () => {
  it("is null when the OS can't encrypt, on every platform", () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      expect(osKeyProtector(fakeStorage({ available: false, backend: "gnome_libsecret" }), platform)).toBeNull();
    }
  });

  it("is null on Linux when the backend is basic_text (a hard-coded password, no real keychain)", () => {
    expect(osKeyProtector(fakeStorage({ backend: "basic_text" }), "linux")).toBeNull();
  });

  it("is null on Linux when the backend is not known yet", () => {
    expect(osKeyProtector(fakeStorage({ backend: "unknown" }), "linux")).toBeNull();
  });

  it("is null on Linux when safeStorage can't say which backend it selected", () => {
    expect(osKeyProtector(fakeStorage({ backend: "absent" }), "linux")).toBeNull();
  });

  it("is a protector on Linux with a real keychain backend", () => {
    for (const backend of ["gnome_libsecret", "kwallet5", "kwallet", "kwallet6"]) {
      expect(osKeyProtector(fakeStorage({ backend }), "linux"), backend).not.toBeNull();
    }
  });

  it("is a protector on macOS and Windows, which don't report a backend", () => {
    expect(osKeyProtector(fakeStorage({ backend: "absent" }), "darwin")).not.toBeNull();
    expect(osKeyProtector(fakeStorage({ backend: "absent" }), "win32")).not.toBeNull();
  });

  it("doesn't look at the Linux backend on other platforms", () => {
    expect(osKeyProtector(fakeStorage({ backend: "basic_text" }), "darwin")).not.toBeNull();
    expect(osKeyProtector(fakeStorage({ backend: "basic_text" }), "win32")).not.toBeNull();
  });

  it("wraps and unwraps a 32-byte key back to the same bytes", () => {
    const protector = osKeyProtector(fakeStorage({ backend: "gnome_libsecret" }), "linux")!;
    const key = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256));
    const wrapped = protector.wrap(key);
    expect(Buffer.isBuffer(wrapped)).toBe(true);
    expect(wrapped.equals(key)).toBe(false);
    const unwrapped = protector.unwrap(wrapped);
    expect(unwrapped).toHaveLength(32);
    expect(unwrapped.equals(key)).toBe(true);
  });

  it("hands the storage the key as text (base64), so any bytes survive the string API", () => {
    const seen: string[] = [];
    const storage = fakeStorage({ backend: "absent" });
    const encrypt = storage.encryptString;
    storage.encryptString = (plain) => {
      seen.push(plain);
      return encrypt(plain);
    };
    const key = Buffer.alloc(32, 0xff);
    osKeyProtector(storage, "darwin")!.wrap(key);
    expect(seen).toEqual([key.toString("base64")]);
  });

  it("lets the storage's refusal through when unwrapping something it didn't encrypt", () => {
    const protector = osKeyProtector(fakeStorage({ backend: "absent" }), "win32")!;
    expect(() => protector.unwrap(Buffer.from("not wrapped by the keychain"))).toThrow("not encrypted by this store");
  });
});
