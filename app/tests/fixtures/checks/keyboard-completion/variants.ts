/**
 * keyboard-completion fixtures. GOOD: pet type is a native radio group (Tab + arrows + Space work).
 * BAD (A03): pet type is a row of clickable <div>s with no tabindex, role or key handlers, so a
 * keyboard-only user can never choose a pet type and the booking can't be created.
 */
import type { BookingVariant } from "../booking-page.js";

export const good: BookingVariant = {};

const nativeRadios = `  <fieldset class="field" id="petType-group">
    <legend>Pet type</legend>
    <label class="choice"><input type="radio" name="petType" value="dog" required> Dog</label>
    <label class="choice"><input type="radio" name="petType" value="cat" required> Cat</label>
    <label class="choice"><input type="radio" name="petType" value="other" required> Other</label>
    <p class="error" id="petType-error" hidden></p>
  </fieldset>`;

const clickableDivs = `  <div class="field" id="petType-group">
    <div class="picker-label">Pet type</div>
    <div class="picker">
      <div class="opt" data-value="dog">Dog</div>
      <div class="opt" data-value="cat">Cat</div>
      <div class="opt" data-value="other">Other</div>
    </div>
    <input type="hidden" name="petType" id="petType" value="">
    <p class="error" id="petType-error" hidden></p>
  </div>`;

export const clickableDivPicker: BookingVariant = {
  replace: [[nativeRadios, clickableDivs]],
  css: [
    ".picker-label { font-weight: 600; margin-bottom: 4px; }",
    ".picker { display: flex; gap: 8px; }",
    ".opt { cursor: pointer; padding: 10px 16px; border: 1px solid #555555; border-radius: 4px; }",
    ".opt.selected { background: #cfe0ff; }",
  ].join("\n"),
  script: `
    for (const el of document.querySelectorAll('.opt')) {
      el.addEventListener('click', () => {
        for (const o of document.querySelectorAll('.opt')) o.classList.remove('selected');
        el.classList.add('selected');
        document.getElementById('petType').value = el.dataset.value;
      });
    }
  `,
};
