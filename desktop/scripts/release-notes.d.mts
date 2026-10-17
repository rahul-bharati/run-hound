export function changelogSection(changelog: string, version: string): string;
export function releaseNotes(options: { version: string; tag: string; changelog: string; assetsDir?: string; installersOnly?: boolean }): Promise<string>;
export function installerNotes(options: { assetsDir: string }): Promise<string>;
