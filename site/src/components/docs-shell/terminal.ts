/**
 * A fenced terminal block in the docs MDX, as the CodeBlock primitive takes it (DESIGN.md §2.5): lines starting with
 * "$ " are the commands (Copy copies these, without the prompt), a "# " line before the first command is the comment,
 * and every other line is real output, shown dim and never copied. A command ending in " \" continues on the next
 * line, as a terminal takes it.
 *
 *     ```sh label="Command line, from source"
 *     $ cd app
 *     $ pnpm exec tsx src/cli.ts run http://localhost:5173/signup --plan-only
 *     ```
 *
 * Plain .ts with no imports: mdx-components.tsx renders it, lib/docs-text.ts writes it into llms-full.txt, and the
 * docs tests read it.
 */
export type Terminal = { commands: string[]; output: string[]; comment?: string };

export function parseTerminal(text: string): Terminal {
  const commands: string[] = [];
  const output: string[] = [];
  const comments: string[] = [];
  let continuing = false;
  for (const line of text.replace(/\n+$/, "").split("\n")) {
    if (continuing) {
      commands[commands.length - 1] += `\n${line}`;
      continuing = / \\$/.test(line);
    } else if (line.startsWith("$ ")) {
      commands.push(line.slice(2));
      continuing = / \\$/.test(line);
    } else if (commands.length === 0 && line.startsWith("# ")) {
      comments.push(line.slice(2));
    } else if (line.trim()) {
      output.push(line);
    }
  }
  return { commands, output, ...(comments.length ? { comment: comments.join(" ") } : {}) };
}
