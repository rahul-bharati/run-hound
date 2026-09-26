/**
 * persistence: submit unique canary values in every field, reload, and fail for every free-text canary that
 * is no longer visible (in the page text or a field). Passwords, dates and choice fields are not compared:
 * they are either never shown or not unique enough to prove anything. When no value is shown as a record after reload
 * and none was shown right after saving either (toasts and status messages don't count: they echo what was typed,
 * they don't list records; nor does the page's banner, which shows who is signed in), the page doesn't display saved
 * records (a newsletter or contact form): the scenario is skipped with that reason instead of reporting lost data. A
 * live region is not a toast: a list announced as it grows (aria-live, or a status element holding a list) counts.
 *
 * When the app moves to another page after saving (a client-side route change, or the page a form post redirected
 * to), that page is loaded fresh, and so is the form's own page. Missing values are reported when one of them shows the
 * saved record: the form's page with any value in it, the other page with two or more (a detail page, a list); or when
 * the other page showed two or more right after saving and no longer does (kept only in memory, never stored). One
 * value there is a greeting ("Welcome aboard, Alex"), which says nothing about the rest: the scenario is skipped with
 * what was found where.
 *
 * A form in a dialog (DiscoveredForm.opener) is opened again after a reload when a value is missing, since an edit
 * dialog shows the saved record in its own fields (LOV-8). A value the server's answer carried but the page no longer
 * shows is reported as "saved but no longer shown after reload", not as "not saved".
 */
import type { Page } from "playwright";
import type { Check, Evidence, Finding, Scenario } from "../core/types.js";
import { openForm, openFormSpec } from "../engine/open-form.js";
import { bodyLines, clip, controlLocator, endpointOf, evidence, fillLines, findingFactory, guarded, markText, recordFlow, requestSummary, result, specSource, tryCard } from "./lib/functional-finding.js";
import { isAcceptedStatus, isPagePost } from "../core/saves.js";
import {
  armFieldErrors,
  canaryValues,
  createRequests,
  fieldName,
  fillForm,
  isRefusedSignIn,
  isSearchForm,
  isSignInForm,
  MULTI_STEP_NOTE,
  settle,
  SIGN_IN_NOTE,
  submitControl,
  submitForm,
  waitForCreates,
  watchNextStep,
  whyNothingSent,
  type FieldValue,
} from "./lib/functional-form.js";

const ID = "persistence" as const;

/**
 * Where a page shows messages that come and go: toast containers (sonner, react-toastify, and the notification
 * regions of Radix, Chakra and the like), and alert and status lines. They echo what was just typed ("Thanks, Alex!"),
 * so they never show that the page lists saved records. A live region as such is not one of them: a list of notes may
 * be announced as it grows (aria-live), and an alert or status element that holds a list or a table is such a list.
 */
const TOASTS = [
  "[data-sonner-toaster]",
  "[data-sonner-toast]",
  ".Toastify",
  '[role=region][aria-label*="otification" i]',
  'section[aria-label*="otification" i]',
].join(", ");
const MESSAGES = "[role=alert], [role=status]";
const LISTS = "ul, ol, dl, table, [role=list], [role=table], [role=grid], [role=feed]";

/**
 * The text a user can read, as written in the page (not as CSS shows it: text-transform is not applied), from every
 * rendered element outside scripts, styles and form fields (text areas and selects: their values are fields'). With `record`, only what can show a saved record: toasts and messages
 * (see TOASTS) are left out, and so is the page's banner (a page-level <header>, role=banner), where an app shows who
 * is signed in ("Alex · alex@example.com") on every page; with `fields`, the values of the fields outside those are
 * added (a settings form shows the saved record in its fields).
 */
const PAGE_TEXT_SCRIPT = `((opts) => {
  const banner = (el) => {
    const b = el.closest("[role=banner], header");
    if (!b) return false;
    if (b.getAttribute("role") === "banner") return true;
    // A <header> inside an article or a section is that part's header (a card's title), not the page's banner.
    const parent = b.parentElement;
    return !(parent && parent.closest("article, aside, main, nav, section, [role=main], [role=article], [role=region], [role=dialog]"));
  };
  const left = (el) => {
    if (!opts.record) return false;
    if (el.closest(${JSON.stringify(TOASTS)})) return true;
    const message = el.closest(${JSON.stringify(MESSAGES)});
    if (message && !message.querySelector(${JSON.stringify(LISTS)})) return true;
    return banner(el);
  };
  const parts = [];
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    // A text area's or select's own text is a field's value, not text on the page: React mirrors a controlled
    // <textarea>'s value into it (defaultValue), so what was just typed would read as a listed record.
    if (!el || el.closest("script, style, noscript, template, textarea, select")) continue;
    if (left(el)) continue;
    if (el.checkVisibility && !el.checkVisibility()) continue;
    parts.push(node.textContent);
  }
  if (opts.fields) {
    for (const el of document.querySelectorAll("input:not([type=password]), textarea, select")) if (!left(el)) parts.push("\\n" + el.value);
  }
  return parts.join("");
})`;

/** Everything a user can read after reload: page text (as shown and as written) plus the values of every field. */
const VISIBLE_TEXT_SCRIPT = `(() => {
  const values = Array.from(document.querySelectorAll("input:not([type=password]), textarea, select")).map((el) => el.value);
  return [document.body ? document.body.innerText : "", ${PAGE_TEXT_SCRIPT}({}), ...values].join("\\n");
})()`;

async function visibleText(page: Page): Promise<string> {
  return String(await page.evaluate(VISIBLE_TEXT_SCRIPT).catch(() => ""));
}

/**
 * What the page shows that could be a saved record: its text outside toasts, messages and the page's banner, and,
 * with `fields`, the values of its fields. Right after saving, the fields still hold what was typed, so they are left
 * out then; after a reload, a field showing a value means the app loaded it.
 */
async function recordViewText(page: Page, fields: boolean): Promise<string> {
  return String(await page.evaluate(`${PAGE_TEXT_SCRIPT}(${JSON.stringify({ record: true, fields })})`).catch(() => ""));
}

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, " ");

/**
 * Whether `text` shows a test value. Case and spacing are ignored (a list may show values in capitals, or wrap them),
 * and a phone number may be shown in any format: "+1 555 0142 123" is found as "(555) 014-2123".
 */
export function showsValue(text: string, value: string): boolean {
  if (normalise(text).includes(normalise(value).trim())) return true;
  if (!/^\+?[\d\s().-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return national.length >= 7 && new RegExp(national.split("").join("[\\s().+-]*")).test(text);
}

/**
 * The page a URL shows: its path, and its hash route ("#/welcome") in a hash-routed app. A query added after saving
 * ("?saved=1") keeps the same page.
 */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.hash.startsWith("#/") ? u.hash : ""}`;
  } catch {
    return url;
  }
}

const names = (values: FieldValue[]) => values.map((v) => fieldName(v.field)).join(", ");

export const check: Check = {
  id: ID,
  title: "Submitted data is saved",
  category: "broken-feature",

  plan(form): Scenario[] {
    // A search form saves nothing, so there is no saved record to test (V1: every form on the page is planned).
    if (isSearchForm(form)) return [];
    return [
      {
        id: "canary-reload",
        checkId: ID,
        title: "Submit unique values, reload and look for them",
        description: isSignInForm(form)
          ? `Will be skipped: ${form.name ?? "this form"} looks like a sign-in form, and signing in saves nothing to look for after a reload.`
          : `Fill every field of ${form.name ?? "the form"} with unique test values, submit, reload the page and check that each value is still shown (passwords excepted). Creates one test record.`,
        kind: "golden",
        priority: "high",
        destructive: false,
        defaultSelected: true,
      },
    ];
  },

  run(ctx, scenario) {
    return guarded(ID, scenario, ctx, async (started) => {
      if (isSignInForm(ctx.form)) return { ...result(ID, scenario, started, []), status: "skipped", notes: SIGN_IN_NOTE };
      const { page, capture } = await ctx.openPage();
      const values = canaryValues(ctx.form, ctx.runToken, "keep");
      const canaries = values.filter((v) => v.canary);
      ctx.step("Typing a unique test value into every field", page);
      const unset = await fillForm(page, values);
      const flow = recordFlow(ctx, page, "values after save and reload");
      await flow.step("Typed unique test values", {
        highlights: canaries.map((v) => ({ selector: v.field.selector, label: `Typed "${clip(v.value, 40)}"`, tone: "info" as const })),
        facts: [{ label: "Test values typed", value: String(canaries.length) }],
      });
      ctx.step("Submitting the form", page);
      const step = await watchNextStep(page, capture, ctx.targetUrl, ctx.runToken);
      await armFieldErrors(page);
      await submitForm(page, ctx.form);
      await waitForCreates(page, capture, ctx.targetUrl, undefined, ctx.runToken);

      const creates = createRequests(capture, ctx.targetUrl, ctx.runToken);
      // 2xx, or a 3xx: a classic form post answers "303 See Other" and the browser loads the page it points to.
      const saved = creates.find((r) => isAcceptedStatus(r.status));
      if (!saved) {
        const statuses = creates.map((r) => r.status ?? r.failure).join(", ");
        const refused = creates.find((r) => r.status !== null && r.status >= 400 && r.status < 500);
        const skip = (notes: string) => ({ ...result(ID, scenario, started, []), status: "skipped" as const, notes });
        if (creates.length === 0) {
          // The first step of a wizard saves nothing: it shows the next step. That is not a refusal.
          if (await step.moved()) return skip(MULTI_STEP_NOTE);
          return skip(`Skipped: submitting the form sent nothing to the server, so there was no saved record to look for. ${await whyNothingSent(page, ctx.form, values, unset)}`);
        }
        if (refused && isRefusedSignIn(ctx.form, refused.status)) return skip(SIGN_IN_NOTE);
        if (refused) {
          return skip(`Skipped: the app refused Run Hound's test values (it answered ${statuses}), so nothing was saved to look for. The made-up values may not meet one of this form's rules.`);
        }
        return skip(`Skipped: the app could not save Run Hound's test values (it answered ${statuses}), so there was no saved record to look for. The failed request is reported by the "No console errors or failed requests" check.`);
      }

      // What the page shows right after saving that could be a saved record: its text outside the fields, toasts,
      // messages and the page's banner (a list, a detail page). Used below to tell "saved and lost" from "this page
      // never shows what it saved" (a newsletter or contact form, a greeting by name).
      const shownAfterSave = await recordViewText(page, false);
      const listedThen = canaries.filter((v) => showsValue(shownAfterSave, v.value));

      await flow.step("Submitted; the server saved it", {
        facts: [{ label: "Save request", value: `${endpointOf(saved.method, saved.url)} → ${saved.status}` }],
      });

      /**
       * What a user can read on the page now. With a form in a dialog, the dialog is opened again when a value is
       * missing, since an edit dialog shows the saved record in its own fields (LOV-8); both views count.
       */
      const readPage = async () => {
        let text = await visibleText(page);
        if (ctx.form.opener && canaries.some((v) => !showsValue(text, v.value)) && (await openForm(page, ctx.form).then(() => true, () => false))) {
          await settle(page);
          text = `${text}\n${await visibleText(page)}`;
        }
        return text;
      };
      const landedUrl = page.url();
      const moved = pathOf(landedUrl) !== pathOf(ctx.targetUrl);
      const formPath = pathOf(ctx.targetUrl);
      let text: string;
      let missing: FieldValue[];
      let found: FieldValue[];
      /** The found value to point at: one shown as part of a record, not in the banner. */
      let anchor: FieldValue | undefined;
      let where = "the page text and every field's value after reload";
      /** Values shown right after saving that are gone now, when that is what shows the loss. */
      let goneSince: { values: FieldValue[]; path: string } | undefined;
      if (!moved) {
        ctx.step("Reloading the page and looking for every test value", page);
        await page.reload({ waitUntil: "load" });
        await settle(page);
        text = await readPage();
        missing = canaries.filter((v) => !showsValue(text, v.value));
        if (missing.length === 0) {
          return result(ID, scenario, started, [], `All ${canaries.length} test values were visible after reload.`);
        }
        found = canaries.filter((v) => !missing.includes(v));
        const listedNow = await recordViewText(page, true);
        anchor = found.find((v) => showsValue(listedNow, v.value));
        if (!anchor && listedThen.length === 0) {
          // Nothing to compare: the page showed none of the values even right after saving, so it doesn't display
          // saved records at all. Reporting that as lost data would be a guess.
          return {
            ...result(ID, scenario, started, []),
            status: "skipped",
            notes: `Skipped: the app accepted the save (${endpointOf(saved.method, saved.url)} → ${saved.status}), but this page doesn't show saved values, not even right after saving, so there is nothing to look for after a reload. That is normal for sign-up, newsletter and contact forms; if this page should list what was saved, that's worth checking by hand.`,
          };
        }
        if (!anchor) goneSince = { values: listedThen, path: formPath };
      } else {
        // The app went to another page: a classic form post lands where the server redirected (reloading it loads it
        // again), a client-side route change keeps what the app had in memory, so that page is loaded fresh (a new
        // history entry: nothing carried over from the form). Where the values should show is that page or the
        // form's own page.
        const landedPath = pathOf(landedUrl);
        const how = isPagePost(saved) ? "where the form post led" : "where the app went after saving";
        const loadLanded = async () => {
          if (isPagePost(saved) && page.url() === landedUrl) await page.reload({ waitUntil: "load" });
          else {
            // Loading the same URL again counts as a reload in Chromium and keeps history.state: go through a blank page.
            await page.goto("about:blank");
            await page.goto(landedUrl, { waitUntil: "load" });
          }
          await settle(page);
        };
        ctx.step(`Loading ${landedPath} (${how}) again and looking for every test value`, page);
        await loadLanded();
        const landedText = await visibleText(page);
        const onLanded = canaries.filter((v) => showsValue(landedText, v.value));
        if (onLanded.length === canaries.length) {
          return result(ID, scenario, started, [], `All ${canaries.length} test values were visible after reload (${landedPath}, ${how}).`);
        }
        const landedListed = await recordViewText(page, true);
        const listedOnLanded = onLanded.filter((v) => showsValue(landedListed, v.value));
        ctx.step(`Loading ${formPath} (the form's page) and looking for the rest`, page);
        await page.goto(ctx.targetUrl, { waitUntil: "load" });
        await settle(page);
        text = await readPage();
        const onForm = canaries.filter((v) => showsValue(text, v.value));
        missing = canaries.filter((v) => !onLanded.includes(v) && !onForm.includes(v));
        if (missing.length === 0) {
          return result(ID, scenario, started, [], `All ${canaries.length} test values were visible after loading ${landedPath} (${how}) and ${formPath} again.`);
        }
        const formListed = await recordViewText(page, true);
        where = `the page text and every field's value of ${landedPath} (${how}) and ${formPath}, each loaded again`;
        // Which page shows the saved record, if any. The form's page listing one value is a list (as on the same page).
        // The page the app went to must show two or more: one value there is a greeting ("Thanks, Alex!", "Welcome
        // aboard, Alex"), which says nothing about the fields it leaves out; two or more are a record view (a detail
        // page rendered from what the server stored, a list). Failing both, the values that page showed right after
        // saving and no longer shows were kept only in memory.
        anchor = onForm.find((v) => showsValue(formListed, v.value));
        if (anchor) found = onForm;
        else if (listedOnLanded.length >= 2) {
          found = onLanded;
          anchor = listedOnLanded[0];
          ctx.step(`Loading ${landedPath} again to show the saved record`, page);
          await loadLanded();
        } else if (listedThen.length >= 2) {
          found = [...onLanded, ...onForm.filter((v) => !onLanded.includes(v))];
          goneSince = { values: listedThen, path: landedPath };
        } else {
          // Only a greeting, the signed-in user's name in the banner, or nothing: that is not a list of saved records,
          // so the values left out say nothing about what was saved.
          const accepted = `the app accepted the save (${endpointOf(saved.method, saved.url)} → ${saved.status}) and went to ${landedPath}`;
          const landedWords = onLanded.length > 0 ? `${landedPath} shows ${names(onLanded)} but not ${names(missing)}` : `${landedPath} shows none of them`;
          const formWords = onForm.length > 0 ? `${formPath} shows ${names(onForm)} only in its header or a message` : `${formPath} shows none`;
          return {
            ...result(ID, scenario, started, []),
            status: "skipped",
            notes:
              onLanded.length + onForm.length > 0
                ? `Skipped: ${accepted}. Loaded again, ${landedWords}, and ${formWords}, so there is no list of saved records to compare: a page that greets you by name, or shows who is signed in, is not one. If a page should list what was saved, that's worth checking by hand.`
                : `Skipped: ${accepted}. Loaded again, neither ${landedPath} nor ${formPath} shows any of the test values, so there is nothing to look for. That is normal after a sign-up or contact form; if a page should list what was saved, that's worth checking by hand.`,
          };
        }
      }

      // A value the server's answer to the save carried, that the page didn't show even right after saving, was saved
      // and is simply not part of what this page shows (a list of cards with a summary of each record): not a loss.
      const echoed = (v: FieldValue) => bodyLines(saved.responseBody).some((l) => l.includes(v.value));
      const summaryOnly = missing.filter((v) => echoed(v) && !listedThen.includes(v));
      if (summaryOnly.length > 0) {
        missing = missing.filter((v) => !summaryOnly.includes(v));
        if (missing.length === 0) {
          const one = summaryOnly.length === 1;
          return result(
            ID,
            scenario,
            started,
            [],
            `The saved record was shown again after reload. ${names(summaryOnly)} ${one ? "is" : "are"} not shown on this page at all, not even right after saving, and the server's response (${endpointOf(saved.method, saved.url)} → ${saved.status}) carried ${one ? "it" : "them"}, so ${one ? "it was" : "they were"} saved; this page just doesn't show ${one ? "that field" : "those fields"}.`,
          );
        }
      }
      const record = anchor ? (await markText(page, anchor.value, "rh-saved", 1))[0] : undefined;
      // The record's full text: CSS may cut it off on screen, so the data shows what is really there.
      const recordText = record ? await page.locator(record).innerText().catch(() => "") : "";
      const missingNames = missing.map((m) => fieldName(m.field)).join(", ");
      await flow.step("After reload", {
        highlights: [
          record
            ? { selector: record, label: `Not found after reload: ${missingNames}` }
            : { selector: ctx.form.selector, label: `Not found after reload: ${missingNames}` },
        ],
        caption: record
          ? `The saved record is back after reload, but ${missing.length === 1 ? `the ${missingNames} value is` : `${missingNames} are`} missing from it.`
          : goneSince
            ? `Right after saving, ${goneSince.path} showed ${names(goneSince.values)}; loaded again, ${missingNames} ${missing.length === 1 ? "is" : "are"} nowhere to be found.`
            : `After reload, ${missingNames} ${missing.length === 1 ? "is" : "are"} nowhere on the page.`,
        facts: [
          ...missing.map((m) => ({ label: `Canary (${fieldName(m.field)})`, value: m.value })),
          { label: "Field", value: missingNames },
          { label: "Searched", value: where },
          { label: "Other test values found", value: `${found.length} of ${canaries.length}` },
          ...(goneSince ? [{ label: "Shown right after saving", value: `${names(goneSince.values)} (${goneSince.path})` }] : []),
          ...(recordText ? [{ label: "Saved record's full text", value: clip(recordText.replace(/\s+/g, " ").trim(), 240) }] : []),
        ],
      });
      const gif = await flow.finish("values after save and reload");
      const make = findingFactory(ID, "broken-feature", scenario);
      const submit = submitControl(ctx.form);
      const findings: Finding[] = [];
      // One problem, however many fields it drops: one finding naming every field, with a card per field (up to 6).
      const request = bodyLines(saved.postData);
      const response = bodyLines(saved.responseBody);
      const cards: Evidence[] = [];
      const perField = missing.map((m) => {
        const name = fieldName(m.field);
        const inRequest = request.some((l) => l.includes(m.value));
        const inResponse = response.some((l) => l.includes(m.value));
        return { m, name, inRequest, inResponse };
      });
      for (const { m, name, inRequest, inResponse } of perField.slice(0, 6)) {
        // The line that should carry the value: the value itself, else the field's key.
        const proves = (l: string) => l.includes(m.value) || l.includes(`"${m.field.key}"`);
        cards.push(
          ...(await tryCard(ctx, `${name} in the save request`, {
            title: inRequest
              ? `"${name}" was sent${inResponse ? " and saved, but is not shown after reload" : ", but the server's response drops it"}`
              : `"${name}" was typed, but the save request does not carry it`,
            subtitle: `${endpointOf(saved.method, saved.url)} → ${saved.status}  ${saved.url}`,
            lines: [
              { text: "Request body" },
              ...request.map((l) => ({ text: `  ${clip(l)}`, mark: proves(l) })),
              { text: `Response ${saved.status}` },
              ...response.map((l) => ({ text: `  ${clip(l)}`, mark: inRequest && proves(l) })),
            ],
            facts: [
              { label: "Canary value", value: m.value },
              { label: "Field", value: name },
              { label: "In request", value: inRequest ? "yes" : "no" },
              { label: "In response", value: inResponse ? "yes" : "no" },
            ],
          })),
        );
      }
      const many = missing.length > 1;
      const first = perField[0]!;
      const quoted = perField.map((f) => `"${f.name}"`).join(", ");
      const fieldList = clip(perField.map((f) => f.name).join(", "), 60);
      // The server's answer to the save carried every missing value: it was saved (as far as the browser can tell), and
      // it is the page that no longer shows it. Still a real loss for the user, but not "not saved".
      const savedNotShown = perField.every((f) => f.inResponse);
      const endpoint = endpointOf(saved.method, saved.url);
      findings.push(
        make({
          title: savedNotShown
            ? many
              ? `${missing.length} fields are saved but no longer shown after reload (${fieldList})`
              : `"${first.name}" is saved but no longer shown after reload`
            : many
              ? `${missing.length} fields are not saved (${fieldList})`
              : `"${first.name}" is not saved`,
          severity: savedNotShown ? "high" : "critical",
          location: `"${first.name}" field`,
          locations: perField.map((f) => `"${f.name}" field`),
          meaning: savedNotShown
            ? `The form sent ${many ? `values in ${quoted}` : `a value in "${first.name}"`} and the server's response (${endpoint} → ${saved.status}) carried ${many ? "them" : "it"} back, so ${many ? "they were" : "it was"} most likely saved. But after reloading the page, ${many ? "those values are" : "that value is"} nowhere to be found: the page doesn't load ${many ? "them" : "it"} again.`
            : many
              ? `The form accepted values in ${quoted} and reported success, but after reloading the page those values are nowhere to be found. They were never saved (or are saved and not shown).`
              : `The form accepted a value in "${first.name}" and reported success, but after reloading the page that value is nowhere to be found. It was never saved (or is saved and not shown).`,
          impact: savedNotShown
            ? `People who come back to the page don't see what they entered in ${quoted}, so they think it was lost and enter it again, or rely on information they can't find.`
            : many
              ? `Anything people type into ${quoted} is silently lost, so they rely on information that does not exist.`
              : `Anything people type into "${first.name}" is silently lost, so they rely on information that does not exist, for example a note or instruction that nobody ever sees.`,
          fix: savedNotShown
            ? `Ask your AI or developer: "After a reload, this page no longer shows ${perField.map((f) => `${f.name} (${f.m.field.key})`).join(", ")}, although ${endpoint} saves ${many ? "them" : "it"}. Load the saved records from the server when the page opens (not only from what was added since), and show ${many ? "each field" : "the field"}."`
            : many
              ? `Ask your AI or developer: "These fields are dropped between the form and the database: ${perField.map((f) => `${f.name} (${f.m.field.key})`).join(", ")}. Make sure each is sent in the request, stored by the server and shown again after reload."`
              : `Ask your AI or developer: "The ${first.name} field (${first.m.field.key}) is dropped between the form and the database. Make sure it is sent in the request, stored by the server and shown again after reload."`,
          evidence: [
            ...gif,
            ...cards,
            evidence("network", "Save request and response", requestSummary(saved, true)),
            evidence(
              "dom",
              many ? `${missing.length} values missing after reload` : `"${first.name}" value missing after reload`,
              perField.map((f) => ({ field: f.m.field.key, name: f.name, submittedValue: f.m.value, inRequest: f.inRequest, inResponse: f.inResponse, searched: where })),
            ),
          ],
          spec: {
            name: many ? "every-field-is-saved" : `${first.name}-is-saved`,
            source: specSource(ctx.targetUrl, many ? "every typed value is still shown after saving and reloading" : `"${first.name}" is still shown after saving and reloading`, [
              ...fillLines(values),
              submit ? `await ${controlLocator(submit)}.click();` : `await page.keyboard.press("Enter");`,
              `await page.waitForLoadState("networkidle");`,
              `await page.reload();`,
              `await page.waitForLoadState("networkidle");`,
              ...openFormSpec(ctx.form),
              `// Shown as text on the page, or as a field's value (a settings form shows the saved record in its fields).`,
              `const shown = (value: string) =>`,
              `  page.evaluate((v) => {`,
              `    const norm = (s: string) => s.toLowerCase().replace(/\\s+/g, " ").trim();`,
              `    const fields = [...document.querySelectorAll("input, textarea, select")].map((f) => (f as HTMLInputElement).value);`,
              `    return [document.body.innerText, ...fields].some((text) => norm(text).includes(norm(v)));`,
              `  }, value);`,
              ...missing.map((m) => `expect(await shown(${JSON.stringify(m.value)}), ${JSON.stringify(fieldName(m.field))}).toBe(true);`),
            ], ctx.form),
          },
        }),
      );
      return result(ID, scenario, started, findings);
    });
  },
};
