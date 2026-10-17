export const PARTS: string[];
export function partsIn(body: string | null | undefined): string[];
export function missingParts(body: string | null | undefined, required: string[]): string[];
export function upsertBlock(body: string | null | undefined, part: string, content: string): string;
export function publishPart(options: {
  gh: (args: string[]) => string;
  tag: string;
  part: string;
  require: string[];
  notes: string;
  files: string[];
  title: string;
  readNotes?: (path: string) => string;
  writeNotes: (body: string) => string;
}): Promise<{ created: boolean; published: boolean; wasPublished: boolean; missing: string[] }>;
export function parseArgs(argv: string[]): { tag: string; part: string; require: string[]; notes: string; title: string | undefined; files: string[] };
