import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from "react";

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
    <main className={`page ${bugClasses}`}>
      <h1>Book a sitter</h1>
      <p className="intro">Tell us about your pet and when you're away. Phone, special instructions and the account are optional.</p>
      {loadError ? (
        <p role="alert" className="alert-box">Kennel could not load. Reload the page to try again.</p>
      ) : config ? (
        <BookingPage config={config} />
      ) : (
        <p>Loading…</p>
      )}
    </main>
  );
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

  return (
    <>
      {available && <p className="availability">Sitters are available for new bookings.</p>}
      <form ref={formRef} className="booking-form" noValidate onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="petName">Pet name</label>
          <div className="with-button">
            <input
              ref={petNameRef}
              id="petName"
              name="petName"
              type="text"
              autoComplete="off"
              required
              value={values.petName}
              onChange={(e) => set("petName", e.target.value)}
              {...a11y("petName")}
            />
            {/* A02: the icon-only button loses its accessible name. */}
            <button
              type="button"
              className="icon-button"
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
          <div className="field">
            <div className="label">Pet type</div>
            <div className="picker" data-kennel="pet-type">
              {PET_TYPES.map((t) => (
                <div
                  key={t.value}
                  className={values.petType === t.value ? "option selected" : "option"}
                  onClick={() => set("petType", t.value)}
                >
                  {t.label}
                </div>
              ))}
            </div>
            {errorFor("petType")}
          </div>
        ) : (
          <div className="field">
            <fieldset className="radios" data-kennel="pet-type" {...(announceErrors && errors.petType ? { "aria-describedby": "petType-error" } : {})}>
              <legend>Pet type</legend>
              {PET_TYPES.map((t) => (
                <label key={t.value} className="radio">
                  <input
                    type="radio"
                    name="petType"
                    value={t.value}
                    required
                    checked={values.petType === t.value}
                    onChange={() => set("petType", t.value)}
                    aria-invalid={(announceErrors && Boolean(errors.petType)) || undefined}
                  />
                  {t.label}
                </label>
              ))}
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

        <div className="field">
          <label htmlFor="ownerEmail">Owner email</label>
          <input
            id="ownerEmail"
            name="ownerEmail"
            type="email"
            autoComplete="email"
            required
            value={values.ownerEmail}
            onChange={(e) => set("ownerEmail", e.target.value)}
            {...a11y("ownerEmail", "email-hint")}
          />
          <p className="hint" id="email-hint" data-kennel="email-hint">
            We only use this to confirm your booking.
          </p>
          {errorFor("ownerEmail")}
        </div>

        <div className="field">
          {/* A01: the phone input is labelled only by its placeholder. */}
          {!bug("A01") && <label htmlFor="phone">Phone</label>}
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
          {errorFor("phone")}
        </div>

        <div className="field">
          <label htmlFor="instructions">Special instructions</label>
          <textarea
            id="instructions"
            name="instructions"
            rows={3}
            value={values.instructions}
            onChange={(e) => set("instructions", e.target.value)}
            {...a11y("instructions")}
          />
          {errorFor("instructions")}
        </div>

        <fieldset className="account">
          <legend>Create an account</legend>
          <p className="hint">Optional. Lets you manage your bookings later.</p>
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
        </fieldset>

        <div className="actions">
          <button type="submit" className="primary" disabled={pending && !bug("F04")}>
            Book
            {pending && <span className="spinner" aria-hidden="true" />}
          </button>
          {/* F01: Save draft has no click handler. */}
          <button type="button" className="secondary" onClick={bug("F01") ? undefined : saveDraft}>
            Save draft
          </button>
        </div>

        <p role="status" className="status">
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
      </form>

      <section className="bookings" aria-labelledby="bookings-title">
        <div className="bookings-head">
          <h2 id="bookings-title">Your bookings</h2>
          {/* F07: the page-level Refresh button (outside the form) has no click handler. */}
          <button type="button" className="secondary" data-kennel="refresh-bookings" onClick={bug("F07") ? undefined : () => void reloadBookings()}>
            Refresh
          </button>
        </div>
        {bookings.length === 0 && <p>No bookings yet.</p>}
        <ul>
          {bookings.map((b) => (
            <li key={b.id}>
              {/* A08: remove buttons shrink to 16x16 px (see styles.css). */}
              <button
                type="button"
                className="icon-button remove"
                data-kennel="remove-booking"
                aria-label={`Remove booking for ${b.petName}`}
                onClick={() => void removeBooking(b)}
              >
                <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <span className="details">
                <strong>{b.petName}</strong> ({TYPE_LABEL[b.petType]}) · {b.startDate} to {b.endDate} · {b.ownerEmail}
                {b.phone && <> · Phone: {b.phone}</>}
                {b.instructions && <> · Notes: {b.instructions}</>}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
