export type AiErrorCode =
  | "not-configured" // disabled, or no model
  | "remote-not-allowed" // remote endpoint without consent; nothing was sent
  | "unreachable" // connection refused, DNS, TLS
  | "timeout"
  | "auth" // 401/403
  | "http" // other non-2xx
  | "bad-output"; // not JSON, or failed validation twice
