/**
 * JSON-only guard for /api/*: a cross-site page can send text/plain without a CORS preflight, but not application/json,
 * so a request with another content type to a POST/PUT is refused with 415. GET and HEAD go through.
 */
export function jsonOnlyApi() {
  return async (
    c: { req: { method: string; header: (name: string) => string | undefined }; json: (body: unknown, status: number) => Response },
    next: () => Promise<void>,
  ) => {
    if (
      (c.req.method === "POST" || c.req.method === "PUT") &&
      !(c.req.header("content-type") ?? "")
        .toLowerCase()
        .startsWith("application/json")
    ) {
      return c.json(
        { error: "Send the request body as application/json." },
        415,
      );
    }
    await next();
  };
}
