/** How saved secrets are kept: wrapped by the OS keychain, by Run Hound's own store, or not saved (environment only). */
export type SecretProtection = "os-keychain" | "run-hound" | "environment";
