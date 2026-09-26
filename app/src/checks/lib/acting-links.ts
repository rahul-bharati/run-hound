/**
 * Links and GET requests that act when they are loaded (0.4.0): a sign-out link, "Disconnect Slack", an invitation's
 * accept link, "/notes?action=delete". Opening one with the run account's session would change its data or end the
 * session every later scenario uses, so discovery leaves them out of DiscoveredPage.linkTargets, deep-links never opens
 * them, and access-control never replays them. Judged by the link's name and by the words of its path and query, with
 * the same word lists as the controls Run Hound never clicks (dead-control isDestructiveControl).
 */
import { isDestructiveControl } from "../dead-control.js";

/** A path segment that acts when loaded, alone ("/logout", "/invites/7/accept"). */
const ACTING_SEGMENT =
  /^(log-?out|log-?off|sign-?out|log_out|sign_out|signoff|unsubscribe|delete|remove|revoke|deactivate|disable|cancel|reset|purge|destroy|erase|leave|disconnect|unlink|archive|trash|discard|accept|decline|approve|reject|confirm|verify|unfollow|unshare)s?$/i;

/** Words that end a session in either order ("session end", "end session"). */
const SESSION_END = /\bsession\s+(end|close|destroy|delete|expire)\b|\b(end|close|destroy|delete|expire)\s+(the\s+|my\s+|this\s+)?session\b/i;

/** "/account/log-out?action=delete" → "account log out action delete": a path and query in words. */
export function urlWords(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://x");
  } catch {
    return "";
  }
  let path = parsed.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep it encoded.
  }
  const query = [...parsed.searchParams.entries()].flat().join(" ");
  return `${path} ${query}`
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_/.=&?+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `words` name something that acts (the destructive and session-ending word lists). */
function actsByWords(words: string): boolean {
  if (!words.trim()) return false;
  if (SESSION_END.test(words)) return true;
  return isDestructiveControl({ accessibleName: words, text: words, role: "link", tag: "a", selector: "", isSubmit: false });
}

/**
 * True when loading `url` would act: a path segment or a query value that acts on its own ("/logout",
 * "/invites/7/accept", "?action=delete"), or path words that end a session. Narrow on purpose: access-control replays
 * the app's own reads, and "/api/payments" is data to protect, not an action.
 */
export function actsWhenLoaded(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://x");
  } catch {
    return false;
  }
  if (parsed.pathname.split("/").some((seg) => ACTING_SEGMENT.test(seg))) return true;
  for (const value of parsed.searchParams.values()) if (ACTING_SEGMENT.test(value)) return true;
  return SESSION_END.test(urlWords(url));
}

/**
 * True when a link named `name` to `url` acts when opened: what actsWhenLoaded says, or its name, path or query words
 * on the lists of controls Run Hound never clicks ("Disconnect Slack", "Log off", "/billing/cancel-plan").
 */
export function linkActs(name: string, url: string): boolean {
  return actsWhenLoaded(url) || actsByWords(name) || actsByWords(urlWords(url));
}
