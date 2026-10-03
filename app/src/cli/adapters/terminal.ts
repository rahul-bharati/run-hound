export function printVersion(stdout: NodeJS.WritableStream, version: string): void {
  stdout.write(`run-hound ${version}\n`);
}
