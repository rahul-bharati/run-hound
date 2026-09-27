import { llmsTxt, textResponse } from "./llms";

// Prerendered at build time: a GET route handler is dynamic unless told otherwise. The file has an extension, so
// trailingSlash leaves /llms.txt as it is (no redirect to /llms.txt/).
export const dynamic = "force-static";

/** /llms.txt (llmstxt.org): what Run Hound is and where to read more, for language models and AI answer engines. */
export function GET() {
  return textResponse(llmsTxt());
}
