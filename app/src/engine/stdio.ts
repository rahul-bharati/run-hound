/**
 * A closed pipe (`run-hound run … | head`) is not an error worth a stack trace: stop quietly, keeping the exit code
 * the run has so far. Any other stream error is re-thrown.
 */
export function exitQuietlyOnClosedPipe(
  stream: NodeJS.WritableStream,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") exit(typeof process.exitCode === "number" ? process.exitCode : 0);
    else throw err;
  });
}
