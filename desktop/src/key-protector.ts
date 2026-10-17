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
 * The OS credential store as Run Hound's key protector, or null when there is none worth using: a weak Linux backend
 * (basic_text, or unknown before ready), which saves the "secret" in the clear. Asks the OS for nothing until the store
 * first wraps or unwraps a key (D10): isEncryptionAvailable() itself reads the keychain item on macOS and fetches the
 * secret key on Linux, so calling it at launch made the OS prompt before the user had done anything. The first wrap
 * or unwrap checks it once; when it says no, both throw an error named KeyStoreUnavailableError (by name: the engine
 * is a separate bundle), and the store falls back to its own key or reports the saved one as locked, never wiping it.
 */
export function osKeyProtector(storage: SafeStorageLike, platform: NodeJS.Platform): KeyProtector | null {
  if (platform === "linux" && WEAK_LINUX_BACKENDS.has(storage.getSelectedStorageBackend?.() ?? "unknown")) return null;
  let available: boolean | undefined;
  const ensure = (): void => {
    available ??= storage.isEncryptionAvailable();
    if (!available) {
      const error = new Error("The system keychain is not available to Run Hound.");
      error.name = "KeyStoreUnavailableError";
      throw error;
    }
  };
  return {
    wrap: (key) => {
      ensure();
      return storage.encryptString(key.toString("base64"));
    },
    unwrap: (wrapped) => {
      ensure();
      return Buffer.from(storage.decryptString(wrapped), "base64");
    },
  };
}
