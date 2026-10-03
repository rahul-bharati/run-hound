/**
 * pii-leak fixtures. The target and a second "analytics" fixture server run on different ports,
 * so the analytics server is a different origin (a third party). The page gets its URL at build time.
 * All variants send a harmless pageview to the third party on load, and POST the booking (including
 * the email) to the SAME origin; only BAD variants also send personal data to the third party.
 */
import type { BookingVariant } from "../booking-page.js";

function withAnalytics(analyticsUrl: string, onBooked: string): BookingVariant {
  return {
    script: `
      const ANALYTICS = ${JSON.stringify(analyticsUrl)};
      fetch(ANALYTICS + '/collect?event=pageview&page=book', { mode: 'no-cors' });
      window.onBooked = async (data) => {
        ${onBooked}
      };
    `,
  };
}

/** GOOD: third party only receives an event name; the email only goes to the same-origin API. */
export const good = (analyticsUrl: string) =>
  withAnalytics(analyticsUrl, `fetch(ANALYTICS + '/collect?event=booking_created', { mode: 'no-cors' });`);

/** BAD (S03): the owner email in the third-party query string. */
export const emailInQuery = (analyticsUrl: string) =>
  withAnalytics(
    analyticsUrl,
    `fetch(ANALYTICS + '/collect?event=booking_created&email=' + encodeURIComponent(data.ownerEmail), { mode: 'no-cors' });`,
  );

/** BAD: the SHA-256 (hex) of the owner email sent to the third party, as ad pixels do. */
export const hashedEmail = (analyticsUrl: string) =>
  withAnalytics(
    analyticsUrl,
    `const bytes = new TextEncoder().encode(String(data.ownerEmail).trim().toLowerCase());
     const digest = await crypto.subtle.digest('SHA-256', bytes);
     const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
     fetch(ANALYTICS + '/collect?event=booking_created&em=' + hex, { mode: 'no-cors' });`,
  );

/** BAD: the phone number in a third-party POST body. */
export const phoneInBody = (analyticsUrl: string) =>
  withAnalytics(
    analyticsUrl,
    `fetch(ANALYTICS + '/collect', { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ event: 'booking_created', phone: data.phone }) });`,
  );
