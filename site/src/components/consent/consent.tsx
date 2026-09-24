"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  CONSENT_EVENT,
  clearAnalyticsCookies,
  openConsentSettings,
  readConsent,
  writeConsent,
  type ConsentChoice,
} from "@/lib/consent";
import { site } from "@/lib/site";

const GA_ID = site.gaMeasurementId;

/** Re-reads the stored choice whenever it changes, here or in another tab. */
function subscribe(onChange: () => void) {
  window.addEventListener(CONSENT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CONSENT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Before hydration the choice is unknown; render nothing rather than guess. */
const UNKNOWN = "unknown";

/**
 * Asks before loading Google Analytics 4 and loads it only after "Accept". Renders nothing when no
 * measurement id is configured. The banner is a labelled region, not a modal: it never traps focus.
 */
export function Consent() {
  const choice = useSyncExternalStore<ConsentChoice | null | typeof UNKNOWN>(subscribe, readConsent, () => UNKNOWN);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    function onConsent(event: Event) {
      const detail = (event as CustomEvent<{ choice?: ConsentChoice; open?: boolean }>).detail;
      if (detail.open) setSettingsOpen(true);
      if (detail.choice) setSettingsOpen(false);
    }
    window.addEventListener(CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(CONSENT_EVENT, onConsent);
  }, []);

  const open = choice !== UNKNOWN && (choice === null || settingsOpen);

  if (!GA_ID) return null;

  function decide(next: ConsentChoice) {
    if (next === "denied") {
      // Stop a running tag and remove its cookies when consent is withdrawn.
      (window as unknown as Record<string, boolean>)[`ga-disable-${GA_ID}`] = true;
      clearAnalyticsCookies();
    }
    writeConsent(next);
  }

  return (
    <>
      {choice === "granted" ? (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
          <Script id="ga4" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
          </Script>
        </>
      ) : null}

      {open ? (
        <section
          aria-labelledby="consent-title"
          className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 backdrop-blur"
        >
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-[72px]">
            <div className="flex max-w-3xl flex-col gap-1.5">
              <h2 id="consent-title" className="font-display text-lg font-bold">
                Analytics cookies
              </h2>
              <p className="text-sm leading-relaxed text-muted">
                With your OK, we use Google Analytics to see which pages are read. It sets cookies. Nothing loads
                unless you accept, and you can change your mind any time under &ldquo;Cookie settings&rdquo;.{" "}
                <Link href="/privacy/#cookies" className="text-accent underline underline-offset-2">
                  Details
                </Link>
              </p>
            </div>
            <div className="flex shrink-0 gap-3">
              <button
                type="button"
                onClick={() => decide("denied")}
                className="min-h-11 rounded-xl border border-line-strong px-5 text-[15px] font-semibold text-fg hover:border-accent hover:text-accent"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => decide("granted")}
                className="min-h-11 rounded-xl border border-line-strong px-5 text-[15px] font-semibold text-fg hover:border-accent hover:text-accent"
              >
                Accept
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}

/** Footer button that reopens the consent banner. Hidden when analytics isn't configured. */
export function CookieSettingsButton({ className = "" }: { className?: string }) {
  if (!GA_ID) return null;
  return (
    <button type="button" onClick={openConsentSettings} className={className}>
      Cookie settings
    </button>
  );
}
