export const INSTALLER_EXTENSIONS: string[];
export function installersIn(dir: string): string[];
export function checksumsFor(dir: string): Promise<{ text: string; sizes: Record<string, number> }>;
