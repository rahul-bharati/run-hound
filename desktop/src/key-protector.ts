/**
 * The OS credential store, through Electron's safeStorage, as the engine's KeyProtector: it wraps the data key of
 * Run Hound's encrypted secret store (app/src/operations/secret-store.ts). Checked against electron 44.5.1's
 * typings: isEncryptionAvailable() is true only after the app's `ready` event, and on Linux
 * getSelectedStorageBackend() reports `basic_text` when Chromium falls back to a hard-coded password.
 */
import type { KeyProtector } from "../../app/src/operations/secret-store.js";

/** The parts of Electron's safeStorage this uses. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Linux backends that are no real keychain: Chromium's hard-coded password, or not known yet (before `ready`). */
const WEAK_LINUX_BACKENDS = new Set(["basic_text", "unknown"]);

/**
 * A KeyProtector over `storage`, or null when encryption isn't available or (Linux) the selected backend is no real
 * keychain; the engine then keeps the key in its own store instead of trusting a weak one. Call after `ready`.
 */
export function osKeyProtector(storage: SafeStorageLike, platform: NodeJS.Platform): KeyProtector | null {
  if (!storage.isEncryptionAvailable()) return null;
  if (platform === "linux" && WEAK_LINUX_BACKENDS.has(storage.getSelectedStorageBackend?.() ?? "unknown")) return null;
  return {
    wrap: (key) => storage.encryptString(key.toString("base64")),
    unwrap: (wrapped) => Buffer.from(storage.decryptString(wrapped), "base64"),
  };
}
