export function changelogSection(changelog: string, version: string): string;
export function releaseNotes(options: { version: string; tag: string; changelog: string; assetsDir?: string }): Promise<string>;
