import { BRIEF_LIMITS } from "../../config/agent.js";

/** What the client script reads to size the brief's inputs (CONFIG.briefLimits); present only when the agent is on. */
export const BRIEF_CLIENT_LIMITS = {
  goalChars: BRIEF_LIMITS.goalChars,
  ticketChars: BRIEF_LIMITS.ticketChars,
  featureChars: BRIEF_LIMITS.featureChars,
  expectationChars: BRIEF_LIMITS.expectationChars,
  dataNameChars: BRIEF_LIMITS.dataNameChars,
  dataValueChars: BRIEF_LIMITS.dataValueChars,
} as const;

const count = (n: number): string => n.toLocaleString("en-US");

/**
 * The New run page's briefs (A2, a preview): the "Describe what to test" form and the card the client script fills
 * with the drafted brief. Rendered into #tpl-new only when the agent is enabled; without it the document holds none
 * of this and the client script never calls /api/briefs. The page's own URL field and "Sign in as" choice are the
 * brief's target and account.
 */
export function briefTemplate(): string {
  return `<section class="card" id="brief-section" aria-labelledby="brief-h">
<h2 id="brief-h" class="card-title">Describe what to test <span class="badge">Preview</span></h2>
<p class="brief-intro">Say what should work, in your own words. Run Hound asks the model for a testing brief for the page and the account chosen above; you edit it and approve it. Running a brief comes in a later version.</p>
<form id="brief-form" novalidate>
<div class="brief-field">
<label class="field-label" for="brief-goal">What do you want to test?</label>
<textarea class="input prose" id="brief-goal" name="goal" rows="3" required maxlength="${BRIEF_LIMITS.goalChars}" placeholder="A signed-in user can add a task, and it is still there after reloading." aria-describedby="brief-goal-hint"></textarea>
<p class="field-hint" id="brief-goal-hint">Required. Up to ${count(BRIEF_LIMITS.goalChars)} characters.</p>
</div>
<div class="brief-field">
<label class="field-label" for="brief-ticket">Ticket text or acceptance criteria <span class="opt">(optional)</span></label>
<textarea class="input prose" id="brief-ticket" name="ticket" rows="4" maxlength="${BRIEF_LIMITS.ticketChars}" aria-describedby="brief-ticket-hint"></textarea>
<p class="field-hint" id="brief-ticket-hint">Each list line (starting with -, *, a number or a checkbox) becomes something the brief expects, in your words. Up to ${count(BRIEF_LIMITS.ticketChars)} characters.</p>
</div>
<div class="brief-field">
<label class="field-label" for="brief-feature">Feature <span class="opt">(optional)</span></label>
<input class="input prose" id="brief-feature" name="feature" type="text" maxlength="${BRIEF_LIMITS.featureChars}" autocomplete="off" placeholder="Tasks" aria-describedby="brief-feature-hint">
<p class="field-hint" id="brief-feature-hint">The part of the app this is about. Up to ${BRIEF_LIMITS.featureChars} characters.</p>
</div>
<div class="brief-actions"><button class="btn primary" id="brief-draft-button" type="submit">Draft a brief</button></div>
<p class="field-hint brief-progress" id="brief-progress" role="status"></p>
<p class="error" id="brief-error" role="alert"></p>
</form>
</section>
<section class="card" id="brief-editor" aria-labelledby="brief-editor-h" hidden>
<div class="brief-head"><h2 id="brief-editor-h" tabindex="-1">Testing brief</h2><span class="tag" id="brief-state"></span></div>
<div id="brief-body"></div>
<div class="brief-foot">
<p class="error" id="brief-edit-error" role="alert"></p>
<p class="field-hint brief-status" id="brief-edit-status" role="status"></p>
<div class="brief-actions"><button class="btn" id="brief-save" type="button" disabled>Save changes</button><button class="btn primary" id="brief-approve" type="button">Approve brief</button></div>
</div>
</section>`;
}
