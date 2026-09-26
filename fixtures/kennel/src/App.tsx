import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from "react";
import { HeroArt, Icon, PawLogo, type IconName } from "./art.js";

/**
 * Kennel's booking page. Clean mode is meant to be genuinely good; every V0 bug (see ../bugs.json and
 * ../CONTRACT.md) is switched on at runtime from GET /api/__config and changes exactly one behaviour.
 * Branches that implement a bug are marked with its id.
 */

type PetType = "dog" | "cat" | "other";
type Field = "petName" | "petType" | "startDate" | "endDate" | "ownerEmail" | "phone" | "instructions";
type Errors = Partial<Record<Field, string>>;

interface Values {
  petName: string;
  petType: PetType | "";
  startDate: string;
  endDate: string;
  ownerEmail: string;
  phone: string;
  instructions: string;
}

interface Booking extends Omit<Values, "petType"> {
  id: string;
  petType: PetType;
  createdAt: string;
}

interface Config {
  bugs: Set<string>;
  analyticsUrl: string;
}

interface ServerError {
  message: string;
  stack?: string;
}

const EMPTY: Values = { petName: "", petType: "", startDate: "", endDate: "", ownerEmail: "", phone: "", instructions: "" };
const PET_TYPES: { value: PetType; label: string }[] = [
  { value: "dog", label: "Dog" },
  { value: "cat", label: "Cat" },
  { value: "other", label: "Other" },
];
const TYPE_LABEL: Record<PetType, string> = { dog: "Dog", cat: "Cat", other: "Other" };
const DRAFT_KEY = "kennel:draft";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELDS: Field[] = ["petName", "petType", "startDate", "endDate", "ownerEmail", "phone", "instructions"];

/** Client-side checks. Length limits are left to the server, whose 400 messages are shown per field. */
function validate(v: Values): Errors {
  const errors: Errors = {};
  if (!v.petName.trim()) errors.petName = "Enter your pet's name.";
  if (!v.petType) errors.petType = "Choose a pet type.";
  if (!v.startDate) errors.startDate = "Enter a start date.";
  if (!v.endDate) errors.endDate = "Enter an end date.";
  else if (v.startDate && v.endDate < v.startDate) errors.endDate = "End date must be on or after the start date.";
  if (!v.ownerEmail.trim()) errors.ownerEmail = "Enter your email address.";
  else if (!EMAIL_RE.test(v.ownerEmail.trim())) errors.ownerEmail = "Enter an email address like name@example.com.";
  return errors;
}

function loadDraft(): Values {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Values>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function problems(n: number) {
  return n === 1 ? "There is 1 problem with your booking." : `There are ${n} problems with your booking.`;
}

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch("/api/__config")
      .then(async (res) => {
        const body = (await res.json()) as { bugs: string[]; analyticsUrl: string };
        if (!res.ok) throw new Error(`config request failed with ${res.status}`);
        return body;
      })
      .then((body) => setConfig({ bugs: new Set(body.bugs), analyticsUrl: body.analyticsUrl }))
      .catch(() => setLoadError(true));
  }, []);

  const bugClasses = config ? [...config.bugs].map((b) => `bug-${b.toLowerCase()}`).join(" ") : "";
  return (
    <div className={`shell ${bugClasses}`}>
      <header className="site-header">
        <div className="container header-inner">
          <span className="brand">
            <PawLogo />
            <span className="brand-name">Kennel</span>
          </span>
          <p className="header-note">
            <Icon name="shieldCheck" size={18} />
            Vetted, insured sitters
          </p>
        </div>
      </header>

      <main className="container page">
        <div className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <Icon name="sparkles" size={16} />
              Pet sitting, made easy
            </p>
            <h1>
              Book a <span className="swash">sitter</span>
            </h1>
            <p className="tagline">Loving, local sitters who treat your pet like family.</p>
            <p className="intro">Tell us about your pet and when you're away. Phone, special instructions and the account are optional.</p>
            <ul className="perks">
              <li>
                <Icon name="badgeCheck" size={18} />
                Background-checked
              </li>
              <li>
                <Icon name="camera" size={18} />
                Daily photo updates
              </li>
              <li>
                <Icon name="heart" size={18} />
                Free cancellation
              </li>
            </ul>
          </div>
          <HeroArt className="hero-art" />
        </div>

        {loadError ? (
          <p role="alert" className="alert-box">Kennel could not load. Reload the page to try again.</p>
        ) : config ? (
          <BookingPage config={config} />
        ) : (
          <p className="loading">Loading…</p>
        )}
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <span className="footer-brand">
            <Icon name="paw" size={16} />
            Kennel
          </span>
          <p>A demo booking app. Bookings live in memory and are cleared when the server restarts.</p>
        </div>
      </footer>
    </div>
  );
}

const PET_ICON: Record<PetType, IconName> = { dog: "dog", cat: "cat", other: "rabbit" };

/** Whole nights between two YYYY-MM-DD dates, or null when they don't parse or run backwards. */
function nights(start: string, end: string): number | null {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000);
}

function stayLength(start: string, end: string): string | null {
  const n = nights(start, end);
  if (n === null) return null;
  return n === 0 ? "Day visit" : n === 1 ? "1 night" : `${n} nights`;
}

function BookingPage({ config }: { config: Config }) {
  const bug = (id: string) => config.bugs.has(id);
  const announceErrors = !bug("A05");

  const [values, setValues] = useState<Values>(loadDraft);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState("");
  const [serverError, setServerError] = useState<ServerError | null>(null);
  const [pending, setPending] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const inFlight = useRef(false);
  const petNameRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function reloadBookings() {
    try {
      const res = await fetch("/api/bookings");
      const text = await res.text();
      if (res.ok) setBookings(JSON.parse(text) as Booking[]);
    } catch {
      // keep the current list; the next action will retry
    }
  }

  useEffect(() => {
    // F05: the availability URL is built from an env var that is never defined at build time.
    const base = bug("F05") ? String(import.meta.env.VITE_AVAILABILITY_API) : "";
    fetch(`${base}/api/availability`)
      .then(async (res) => {
        // Always read the body so the request completes even on errors.
        const text = await res.text();
        if (!res.ok) throw new Error(`availability request failed with ${res.status}`);
        setAvailable((JSON.parse(text) as { available: boolean }).available);
      })
      .catch((err: unknown) => console.error("Could not check sitter availability:", err));
    void reloadBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (field: keyof Values, value: string) => setValues((v) => ({ ...v, [field]: value }));

  function focusFirstInvalid(errs: Errors) {
    const first = FIELDS.find((f) => errs[f]);
    if (!first) return;
    const el = formRef.current?.querySelector<HTMLElement>(first === "petType" ? 'input[name="petType"]' : `#${first}`);
    el?.focus();
  }

  function showFieldErrors(errs: Errors) {
    setErrors(errs);
    // A05: errors stay red text only; nothing is announced.
    setStatus(announceErrors ? problems(Object.keys(errs).length) : "");
    focusFirstInvalid(errs);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // F04: no in-flight guard (and Book is never disabled), so a double click books twice.
    if (!bug("F04") && inFlight.current) return;
    setServerError(null);
    const errs = validate(values);
    if (Object.keys(errs).length) return showFieldErrors(errs);

    setErrors({});
    setStatus("");
    inFlight.current = true;
    setPending(true);
    const payload = {
      petName: values.petName.trim(),
      petType: values.petType,
      startDate: values.startDate,
      endDate: values.endDate,
      ownerEmail: values.ownerEmail.trim(),
      phone: values.phone.trim(),
      // F03: special instructions are silently dropped from the request.
      instructions: bug("F03") ? "" : values.instructions.trim(),
    };

    let res: Response;
    let body: { errors?: Record<string, string>; error?: string; stack?: string } | undefined;
    try {
      res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      body = (await res.json().catch(() => undefined)) as typeof body;
    } catch {
      return failed({ message: "Something went wrong. Check your connection and try again." });
    }

    if (res.status === 201) {
      inFlight.current = false;
      setPending(false);
      setValues(EMPTY);
      setPassword("");
      setConfirmPassword("");
      setStatus("Booking saved");
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // storage unavailable; nothing to clear
      }
      void reloadBookings();
      track(payload.ownerEmail);
      return;
    }
    if (res.status === 400 && body?.errors && !body.errors.body) {
      inFlight.current = false;
      setPending(false);
      const errs: Errors = {};
      for (const f of FIELDS) if (body.errors[f]) errs[f] = body.errors[f];
      return showFieldErrors(errs);
    }
    failed({
      message: typeof body?.error === "string" ? body.error : "Something went wrong",
      // S04: the server's stack trace is rendered in the page.
      stack: bug("S04") ? body?.stack : undefined,
    });
  }

  function failed(error: ServerError) {
    // F02: server errors leave the spinner running and show nothing.
    if (bug("F02")) return;
    inFlight.current = false;
    setPending(false);
    setServerError(error);
  }

  /** Tells the mock third-party analytics service that a booking happened. */
  function track(email: string) {
    const url = bug("S03")
      ? // S03: personal data in a third-party query string.
        `${config.analyticsUrl}/collect?event=booking_created&email=${encodeURIComponent(email)}`
      : `${config.analyticsUrl}/collect`;
    const init: RequestInit = bug("S03")
      ? { method: "GET", keepalive: true }
      : { method: "POST", body: JSON.stringify({ event: "booking_created" }), keepalive: true };
    // Read the (empty) body: an unread response is cancelled by Chromium and reported to observers
    // as net::ERR_ABORTED, which would look like a failed request in clean mode.
    fetch(url, init)
      .then((res) => res.arrayBuffer())
      .catch(() => {
        // analytics is best effort
      });
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(values));
      setStatus("Draft saved");
    } catch {
      setStatus("Could not save the draft in this browser.");
    }
  }

  function clearPetName() {
    set("petName", "");
    petNameRef.current?.focus();
  }

  async function removeBooking(b: Booking) {
    const res = await fetch(`/api/bookings/${encodeURIComponent(b.id)}`, { method: "DELETE" }).catch(() => null);
    setStatus(res?.ok ? `Removed the booking for ${b.petName}` : `Could not remove the booking for ${b.petName}`);
    await reloadBookings();
  }

  /** Accessible wiring for a field: aria-invalid + aria-describedby to its error (not with A05). */
  function a11y(field: Field, describedBy?: string) {
    const invalid = Boolean(errors[field]) && announceErrors;
    const ids = [describedBy, invalid ? `${field}-error` : undefined].filter(Boolean).join(" ");
    return { "aria-invalid": invalid || undefined, "aria-describedby": ids || undefined };
  }

  function errorFor(field: Field): ReactNode {
    const message = errors[field];
    if (!message) return null;
    return (
      <p className="error" id={announceErrors ? `${field}-error` : undefined}>
        {message}
      </p>
    );
  }


  const blockPaste = (e: ClipboardEvent<HTMLInputElement>) => e.preventDefault();
  const statusTone = /problem|Could not/.test(status) ? "warn" : "ok";

  return (
    <div className="workspace">
      <div className="card form-card">
        <div className="card-top">
          {available && (
            <p className="availability">
              <span className="pulse" aria-hidden="true" />
              Sitters are available for new bookings.
            </p>
          )}
          <p className="eta">
            <Icon name="clock" size={16} />
            Takes about 2 minutes
          </p>
        </div>

        <form ref={formRef} className="booking-form" noValidate onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="petName">Pet name</label>
            <div className="with-button control">
              <Icon name="paw" className="control-icon" size={18} />
              <input
                ref={petNameRef}
                id="petName"
                name="petName"
                type="text"
                autoComplete="off"
                placeholder="e.g. Biscuit"
                required
                value={values.petName}
                onChange={(e) => set("petName", e.target.value)}
                {...a11y("petName")}
              />
              {/* A02: the icon-only button loses its accessible name. */}
              <button
                type="button"
                className="icon-button clear"
                data-kennel="clear-pet-name"
                aria-label={bug("A02") ? undefined : "Clear pet name"}
                onClick={clearPetName}
              >
                <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {errorFor("petName")}
          </div>

          {bug("A03") ? (
            // A03: the pet type picker is clickable divs with no role, tabindex or keyboard support.
            <div className="field pet-type-field">
              <div className="label">Pet type</div>
              <div className="picker choice-grid" data-kennel="pet-type">
                {PET_TYPES.map((t) => (
                  <div
                    key={t.value}
                    className={values.petType === t.value ? "option choice selected" : "option choice"}
                    onClick={() => set("petType", t.value)}
                  >
                    <Icon name={PET_ICON[t.value]} className="choice-icon" size={22} />
                    {t.label}
                  </div>
                ))}
              </div>
              {errorFor("petType")}
            </div>
          ) : (
            <div className="field pet-type-field">
              <fieldset className="radios" data-kennel="pet-type" {...(announceErrors && errors.petType ? { "aria-describedby": "petType-error" } : {})}>
                <legend>Pet type</legend>
                <div className="choice-grid">
                  {PET_TYPES.map((t) => (
                    <label key={t.value} className="radio choice">
                      <input
                        type="radio"
                        name="petType"
                        value={t.value}
                        required
                        checked={values.petType === t.value}
                        onChange={() => set("petType", t.value)}
                        aria-invalid={(announceErrors && Boolean(errors.petType)) || undefined}
                      />
                      <Icon name={PET_ICON[t.value]} className="choice-icon" size={22} />
                      {t.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              {errorFor("petType")}
            </div>
          )}

          <div className="dates">
            <div className="field">
              <label htmlFor="startDate">Start date</label>
              <input
                id="startDate"
                name="startDate"
                type="date"
                required
                value={values.startDate}
                onChange={(e) => set("startDate", e.target.value)}
                {...a11y("startDate")}
              />
              {errorFor("startDate")}
            </div>
            <div className="field">
              <label htmlFor="endDate">End date</label>
              <input
                id="endDate"
                name="endDate"
                type="date"
                required
                min={values.startDate || undefined}
                value={values.endDate}
                onChange={(e) => set("endDate", e.target.value)}
                {...a11y("endDate")}
              />
              {errorFor("endDate")}
            </div>
          </div>

          <div className="contact">
            <div className="field">
              <label htmlFor="ownerEmail">Owner email</label>
              <div className="control">
                <Icon name="mail" className="control-icon" size={18} />
                <input
                  id="ownerEmail"
                  name="ownerEmail"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  required
                  value={values.ownerEmail}
                  onChange={(e) => set("ownerEmail", e.target.value)}
                  {...a11y("ownerEmail", "email-hint")}
                />
              </div>
              <p className="hint" id="email-hint" data-kennel="email-hint">
                We only use this to confirm your booking.
              </p>
              {errorFor("ownerEmail")}
            </div>

            <div className="field">
              {/* A01: the phone input is labelled only by its placeholder. */}
              {!bug("A01") && (
                <div className="label-row">
                  <label htmlFor="phone">Phone</label>
                  <span className="optional">Optional</span>
                </div>
              )}
              <div className="control">
                <Icon name="phone" className="control-icon" size={18} />
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder={bug("A01") ? "Phone" : undefined}
                  value={values.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  {...a11y("phone")}
                />
              </div>
              {errorFor("phone")}
            </div>
          </div>

          <div className="field">
            <div className="label-row">
              <label htmlFor="instructions">Special instructions</label>
              <span className="optional">Optional</span>
            </div>
            <textarea
              id="instructions"
              name="instructions"
              rows={3}
              placeholder="Feeding times, walks, medication, favourite toys…"
              value={values.instructions}
              onChange={(e) => set("instructions", e.target.value)}
              {...a11y("instructions")}
            />
            {errorFor("instructions")}
          </div>

          <fieldset className="account">
            <legend>
              <Icon name="lock" size={18} />
              Create an account
            </legend>
            <p className="hint">Optional. Lets you manage your bookings later.</p>
            <div className="account-grid">
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="confirmPassword">Confirm password</label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  // A07: paste is blocked on the confirm field.
                  onPaste={bug("A07") ? blockPaste : undefined}
                />
              </div>
            </div>
          </fieldset>

          <div className="form-foot">
            <div className="actions">
              <button type="submit" className="primary" disabled={pending && !bug("F04")}>
                Book
                {pending ? <span className="spinner" aria-hidden="true" /> : <Icon name="arrowRight" size={18} />}
              </button>
              {/* F01: Save draft has no click handler. */}
              <button type="button" className="secondary" onClick={bug("F01") ? undefined : saveDraft}>
                <Icon name="save" size={18} />
                Save draft
              </button>
            </div>

            <p role="status" className="status" data-tone={statusTone}>
              {status}
            </p>
            <div role="alert" className="alert">
              {serverError && (
                <div className="alert-box">
                  <p>{serverError.message}</p>
                  {serverError.stack && <pre className="stack">{serverError.stack}</pre>}
                </div>
              )}
            </div>
          </div>
        </form>
      </div>

      <div className="side">
        <section className="card bookings" aria-labelledby="bookings-title">
          <div className="bookings-head">
            <div className="bookings-title">
              <h2 id="bookings-title">Your bookings</h2>
              {bookings.length > 0 && <span className="count">{bookings.length}</span>}
            </div>
            {/* F07: the page-level Refresh button (outside the form) has no click handler. */}
            <button type="button" className="secondary small" data-kennel="refresh-bookings" onClick={bug("F07") ? undefined : () => void reloadBookings()}>
              <Icon name="refresh" size={16} />
              Refresh
            </button>
          </div>
          {bookings.length === 0 && (
            <div className="empty">
              <span className="empty-icon" aria-hidden="true">
                <Icon name="paw" size={22} />
              </span>
              <p>No bookings yet.</p>
              <p className="empty-sub">Your upcoming stays will show up here.</p>
            </div>
          )}
          <ul>
            {bookings.map((b) => {
              const stay = stayLength(b.startDate, b.endDate);
              return (
                <li key={b.id} className={`booking pet-${b.petType}`}>
                  <span className="avatar" aria-hidden="true">
                    <Icon name={PET_ICON[b.petType] ?? "paw"} size={20} />
                  </span>
                  <span className="details">
                    <span className="booking-top">
                      <strong className="pet-name">{b.petName}</strong>
                      <span className="badge">{TYPE_LABEL[b.petType]}</span>
                      {stay && <span className="stay">{stay}</span>}
                    </span>
                    <span className="booking-line">
                      <Icon name="calendar" size={15} />
                      <span>
                        {b.startDate} to {b.endDate}
                      </span>
                    </span>
                    <span className="booking-line">
                      <Icon name="mail" size={15} />
                      <span className="email">{b.ownerEmail}</span>
                    </span>
                    {b.phone && (
                      <span className="booking-line">
                        <Icon name="phone" size={15} />
                        <span>
                          <span className="sr-only">Phone: </span>
                          {b.phone}
                        </span>
                      </span>
                    )}
                    {b.instructions && (
                      <span className="notes">
                        <span className="notes-label">Notes: </span>
                        {b.instructions}
                      </span>
                    )}
                  </span>
                  {/* A08: remove buttons shrink to 16x16 px (see styles.css). */}
                  <button
                    type="button"
                    className="icon-button remove"
                    data-kennel="remove-booking"
                    aria-label={`Remove booking for ${b.petName}`}
                    onClick={() => void removeBooking(b)}
                  >
                    <Icon name="trash" size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card how" aria-labelledby="how-title">
          <h2 id="how-title">How Kennel works</h2>
          <ol className="steps">
            <li>
              <span className="step-icon" aria-hidden="true">
                <Icon name="notes" size={18} />
              </span>
              <span>
                <strong>Tell us about your pet</strong>
                <span className="step-text">Dates, routines and any special needs.</span>
              </span>
            </li>
            <li>
              <span className="step-icon" aria-hidden="true">
                <Icon name="heart" size={18} />
              </span>
              <span>
                <strong>Meet your sitter</strong>
                <span className="step-text">We match you with a vetted local sitter.</span>
              </span>
            </li>
            <li>
              <span className="step-icon" aria-hidden="true">
                <Icon name="camera" size={18} />
              </span>
              <span>
                <strong>Relax while you're away</strong>
                <span className="step-text">Get photo updates every day of the stay.</span>
              </span>
            </li>
          </ol>
        </section>
      </div>
    </div>
  );
}
