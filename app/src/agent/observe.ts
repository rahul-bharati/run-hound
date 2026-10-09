/**
 * Observations (A3a, docs/agent-spec.md "Observations"): Playwright's AI-mode aria snapshot made safe to show a model.
 * Pure: the snapshot JSON in, a PageObservation and the refs it issued out, so it is tested without a browser.
 */

import { isRecord, oneLine } from "../ai/schema.js";
import { isDestructiveControl } from "../checks/dead-control.js";
import { AGENT_OBSERVATION_LIMITS as LIMITS } from "../config/agent.js";
import { AGENT_CONTROL_ROLES, AGENT_EDITABLE_ROLES } from "../constants/agent-constants.js";
import type { ObservedNode, PageObservation } from "../interfaces/agent.js";

/** What the page was when it was snapshotted; the snapshot itself is the tree. */
export interface ObservationMeta {
  /** This observation's number: the prefix of every ref it issues ("4.e17"). */
  number: number;
  /** The target's origin: links on it show their path, others their origin. */
  origin: string;
  /** The page's path (no query or hash). */
  path: string;
  title: string | null;
  status: number | null;
  problems: PageObservation["problems"];
  dialog: PageObservation["dialog"];
}

/** Options a select lists, at most. */
const MAX_OPTIONS = 20;

/** The children of a node, whatever Playwright put there. */
const childrenOf = (raw: Record<string, unknown>): unknown[] => (Array.isArray(raw.children) ? raw.children : []);

/** A child the parent reads as text: a bare string, a "text" node, or a node with no ref (except a select's options). */
const isTextual = (child: unknown): boolean =>
  typeof child === "string" || (isRecord(child) && (child.role === "text" || (typeof child.ref !== "string" && child.role !== "option")));

/** The text a node's textual children hold, deepest included. */
function textOf(children: unknown[]): string[] {
  return children.filter(isTextual).flatMap((c) => {
    if (typeof c === "string") return [c];
    const node = c as Record<string, unknown>;
    return [node.name, node.text].filter((t): t is string => typeof t === "string" && t !== "").concat(textOf(childrenOf(node)));
  });
}

/**
 * The observation for `snapshot` (the value page.ariaSnapshotJSON({ mode: "ai" }) returned), and the refs it issued:
 * each model-visible ref ("4.e17") mapped to Playwright's ("e17"). `hide` redacts every name and text before it is
 * cut. Field values become `filled`, a select's options its `options`, iframes lose their content, empty generic
 * wrappers are flattened, controls isDestructiveControl refuses are marked, and the tree is cut to
 * AGENT_OBSERVATION_LIMITS (then `truncated`). Anything that isn't a node is ignored.
 */
export function toObservation(
  snapshot: unknown,
  meta: ObservationMeta,
  hide: (text: string) => string,
): { observation: PageObservation; refs: Map<string, string> } {
  const refs = new Map<string, string>();
  let count = 0;
  let chars = 0;
  let truncated = false;
  const cut = (text: string, max: number): string => oneLine(hide(text), max);

  /** The path of a same-origin link, else the other origin (or the scheme, for mailto: and the like). */
  const linkTarget = (raw: string): string | null => {
    try {
      const url = new URL(raw, meta.origin);
      if (url.origin === meta.origin) return cut(url.pathname, LIMITS.textChars);
      return url.origin !== "null" ? url.origin : url.protocol;
    } catch {
      return null;
    }
  };

  /** Whether one more node of this size fits; marks the observation truncated when it doesn't. */
  const fits = (node: ObservedNode): boolean => {
    const size = JSON.stringify(node).length;
    if (count >= LIMITS.nodes || chars + size > LIMITS.totalChars) {
      truncated = true;
      return false;
    }
    count += 1;
    chars += size;
    return true;
  };

  /** The nodes `raw` contributes to its parent, depth first: itself, or its children when it has nothing of its own. */
  const convert = (raw: unknown): ObservedNode[] => {
    if (!isRecord(raw) || typeof raw.role !== "string" || raw.role === "text") return [];
    const role = raw.role;
    const children = childrenOf(raw);
    const ref = typeof raw.ref === "string" ? raw.ref : null;
    // A node with no ref can't be acted on: its text went to its parent (textOf), its children are lifted.
    if (ref === null) return children.flatMap(convert);

    const rawName = typeof raw.name === "string" ? raw.name : "";
    const rawText = typeof raw.text === "string" ? raw.text : "";
    const editable = AGENT_EDITABLE_ROLES.includes(role);
    // A select's options carry no refs and can't be acted on one by one: they become the select's option list.
    const listed = children.filter((c): c is Record<string, unknown> => isRecord(c) && c.role === "option" && typeof c.ref !== "string");
    const rest = role === "iframe" ? [] : children.filter((c) => !listed.includes(c as Record<string, unknown>));

    const node: ObservedNode = { ref: `${meta.number}.${ref}`, role };
    const name = cut(rawName, LIMITS.nameChars);
    if (name !== "") node.name = name;
    const text = editable ? "" : cut([rawText, ...textOf(rest)].join(" "), LIMITS.textChars);
    if (text !== "") node.text = text;
    if (editable) node.filled = rawText !== "" || listed.some((o) => o.selected === true);
    if (role === "link" && typeof raw.url === "string") {
      const url = linkTarget(raw.url);
      if (url !== null) node.url = url;
    }
    if (typeof raw.checked === "boolean" || raw.checked === "mixed") node.checked = raw.checked;
    if (typeof raw.disabled === "boolean") node.disabled = raw.disabled;
    if (typeof raw.expanded === "boolean") node.expanded = raw.expanded;
    if (typeof raw.invalid === "boolean") node.invalid = raw.invalid;
    if (typeof raw.pressed === "boolean" || raw.pressed === "mixed") node.pressed = raw.pressed;
    if (typeof raw.selected === "boolean" && role !== "option") node.selected = raw.selected;
    if (typeof raw.level === "number") node.level = raw.level;
    if (listed.length > 0) {
      node.options = listed
        .map((o) => (typeof o.name === "string" ? cut(o.name, LIMITS.nameChars) : ""))
        .filter((o) => o !== "")
        .slice(0, MAX_OPTIONS);
    }
    if (AGENT_CONTROL_ROLES.includes(role) && isDestructiveControl({ accessibleName: rawName, text: rawText, role, tag: "", selector: "", isSubmit: false })) node.destructive = true;

    // An unnamed wrapper with no text that isn't clickable says nothing: its children take its place.
    if (role === "generic" && name === "" && text === "" && raw.cursor !== "pointer") return rest.flatMap(convert);
    if (!fits(node)) return [];
    refs.set(node.ref, ref);
    const kids = rest.flatMap(convert);
    if (kids.length > 0) node.children = kids;
    return [node];
  };

  const roots = Array.isArray(snapshot) ? snapshot : [snapshot];
  const tree = roots.flatMap(convert);
  const observation: PageObservation = {
    path: meta.path,
    title: meta.title === null ? null : cut(meta.title, LIMITS.nameChars) || null,
    status: meta.status,
    tree,
    truncated,
    problems: { ...meta.problems },
    dialog: meta.dialog === null ? null : { type: meta.dialog.type, message: cut(meta.dialog.message, LIMITS.textChars) },
  };
  return { observation, refs };
}
