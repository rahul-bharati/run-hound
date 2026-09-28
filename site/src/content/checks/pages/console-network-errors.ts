import type { CheckPage } from "./types";

/**
 * /checks/console-network-errors/. Sources: app/src/checks/console-network-errors.ts (what fails the check, the
 * browser's own cancellations and dev-server plumbing it leaves out, a sign-in form's refusals, load errors reported
 * once per page), the Kennel 0.6.0 run's featured finding (content/runs/kennel-0.6.0.json: the steps, the error card
 * and frame, the test) and TESTING.md "Known limitations" (one page per run, development overlays).
 */
export const page = {
  id: "console-network-errors",
  description:
    "How the console and network errors check sends a form and flags every console error and failed request, with a real finding, its test and the fix.",
  lede: "A page can look finished while a request behind it fails or its code throws. AI builders often read an API address from a setting one environment lacks, so a feature quietly stops working. The page itself shows no error.",
  severity: "medium",
  steps: [
    {
      label: "Loaded the form, watching the console and network",
      line: "From the first request on, Run Hound records every console message, uncaught error and network answer.",
    },
    {
      label: "Filling every field with valid test values",
      line: "Each field gets a value the form accepts, so an error can't be blamed on bad input.",
    },
    {
      label: "Submitting the form",
      line: "The form is sent for real, and the save request is followed until the server answers.",
    },
    {
      label: "Counting console errors, page errors and failed requests",
      line: "Any console error, uncaught page error, failed request or answer of 400 or more fails the check.",
    },
  ],
  notCounted:
    "Requests the browser cancels itself, such as one cut off by leaving the page, and dev servers' hot-reload traffic. On a sign-in form, the app refusing made-up credentials is left out: that is the app working.",
  evidence: [
    {
      label: "page after submitting",
      caption: "The booking was saved, yet the availability request behind the page failed.",
      alt: "Kennel's booking page after sending the form, beside Run Hound's facts: 1 failed request and 2 console errors.",
    },
    {
      label: "errors while loading and submitting",
      caption: "The error card: the failed request and both console errors came while loading.",
    },
  ],
  reproduce:
    'The exported test opens the page, then records console errors, page errors, failed requests and answers of 400 or more. It fills the form with the run\'s values, clicks "Book" and expects that list to stay empty.',
  background: [
    {
      label: "MDN: HTTP response status codes",
      href: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status",
      why: "Answers of 400 or more are errors; 404 means nothing exists at the address the page asked for.",
    },
    {
      label: "MDN: Using the Fetch API",
      href: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch",
      why: "fetch() doesn't reject when the server answers 404, so code has to check the status before trusting the answer.",
    },
  ],
  limits: [
    "Only the page load and one submit are watched: an error that needs another click, or another page, goes unseen.",
    "On a page with several forms, errors while loading are reported once, by the first form's scenario.",
    "A development overlay, such as Next.js dev tools, is part of the page, so its errors count too.",
  ],
  related: ["silent-failure", "deep-links"],
} as const satisfies CheckPage;
