// RSVP form: validates in the browser and saves with fetch (JSON) to an API on ANOTHER origin
// (same host, the port in <meta name="api-port">), which allows this page through CORS.
const apiPort = document.querySelector('meta[name="api-port"]').content;
const API = `${location.protocol}//${location.hostname}:${apiPort}`;

const form = document.getElementById("rsvp");
const button = document.getElementById("send");
const status = document.getElementById("status");
const list = document.getElementById("rsvps");
const empty = document.getElementById("empty");

const FIELDS = ["name", "email", "attending", "guests", "dietary"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setStatus(text, tone) {
  status.textContent = text;
  status.className = `status${tone ? ` is-${tone}` : ""}`;
}

function inputFor(key) {
  return key === "attending" ? form.querySelector('input[name="attending"]') : form.elements.namedItem(key);
}

function showErrors(errors) {
  for (const key of FIELDS) {
    const message = errors[key] ?? "";
    document.getElementById(`${key}-error`).textContent = message;
    const targets = key === "attending" ? form.querySelectorAll('input[name="attending"]') : [inputFor(key)];
    for (const input of targets) {
      if (message) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  }
  const first = FIELDS.find((key) => errors[key]);
  if (first) inputFor(first).focus();
}

function readValues() {
  return {
    name: form.elements.namedItem("name").value.trim(),
    email: form.elements.namedItem("email").value.trim(),
    attending: form.querySelector('input[name="attending"]:checked')?.value ?? "",
    guests: Number(form.elements.namedItem("guests").value),
    dietary: form.elements.namedItem("dietary").value.trim(),
  };
}

function validate(v) {
  const errors = {};
  if (!v.name) errors.name = "Enter your name";
  if (!v.email) errors.email = "Enter your email address";
  else if (!EMAIL.test(v.email)) errors.email = "Enter an email address in the format name@example.com";
  if (v.attending !== "yes" && v.attending !== "no") errors.attending = "Choose whether you're coming";
  if (!Number.isInteger(v.guests) || v.guests < 1 || v.guests > 6) errors.guests = "Enter a number from 1 to 6";
  return errors;
}

function render(rsvps) {
  list.replaceChildren(
    ...rsvps.map((r) => {
      const li = document.createElement("li");
      const who = document.createElement("strong");
      who.textContent = `${r.name} (${r.email})`;
      const line = document.createElement("p");
      line.className = "meta";
      line.textContent = r.attending === "yes" ? `Coming, ${r.guests} ${r.guests === 1 ? "person" : "people"}` : "Not coming";
      li.append(who, line);
      if (r.dietary) {
        const diet = document.createElement("p");
        diet.textContent = `Dietary needs: ${r.dietary}`;
        li.append(diet);
      }
      return li;
    }),
  );
  empty.hidden = rsvps.length > 0;
}

async function loadRsvps() {
  try {
    const res = await fetch(`${API}/api/rsvps`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    render((await res.json()).rsvps);
  } catch {
    empty.hidden = false;
    empty.textContent = "The replies couldn't be loaded. Reload the page to try again.";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  const values = readValues();
  const errors = validate(values);
  showErrors(errors);
  const count = Object.keys(errors).length;
  if (count > 0) {
    setStatus(`Your RSVP wasn't sent: please fix ${count === 1 ? "1 problem" : `${count} problems`}.`, "error");
    return;
  }

  button.disabled = true;
  button.textContent = "Sending…";
  setStatus("Sending your RSVP…");
  try {
    const res = await fetch(`${API}/api/rsvps`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(values),
    });
    if (res.status === 201) {
      form.reset();
      setStatus("Thanks, your RSVP is saved.", "ok");
      await loadRsvps();
    } else if (res.status === 400) {
      const body = await res.json().catch(() => ({}));
      showErrors(body.errors ?? {});
      setStatus("Your RSVP wasn't sent: please fix the highlighted fields.", "error");
    } else {
      setStatus("Sorry, your RSVP couldn't be sent. Please try again in a moment.", "error");
    }
  } catch {
    setStatus("Sorry, your RSVP couldn't be sent. Check your connection and try again.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Send RSVP";
  }
});

loadRsvps();
