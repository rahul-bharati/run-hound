// Shared CLI test result shapes (subprocess-driven CLI tests).
export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// Subprocess-driven CLI tests that time the run add this on top.
export interface CliTimedResult extends CliResult {
  ms: number;
}