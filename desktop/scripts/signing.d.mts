export type Signing = { state: "signed" | "unsigned" | "not-required"; reason: string };
export const SIGNING_VARIABLES: string[];
export function resolveSigning(platform: string, env: Record<string, string | undefined>): Signing;
export function builderEnv(signing: Signing, env: Record<string, string | undefined>): Record<string, string | undefined>;
