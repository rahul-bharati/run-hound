// Contact form: validates in the browser, saves with fetch (JSON) to /api/messages on this origin,
// and lists saved messages from GET /api/messages so they survive a reload.
const form = document.getElementById("contact");
const button = document.getElementById("send");
const status = document.getElementById("status");
const list = document.getElementById("messages");
const empty = document.getElementById("empty");

const FIELDS = ["name", "email", "topic", "message"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setStatus(text, tone) {
  status.textContent = text;
  status.className = `status${tone ? ` is-${tone}` : ""}`;
}

function showErrors(errors) {
  for (const key of FIELDS) {
    const input = form.elements.namedItem(key);
    const message = errors[key] ?? "";
    document.getElementById(`${key}-error`).textContent = message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
  const first = FIELDS.find((key) => errors[key]);
  if (first) form.elements.namedItem(first).focus();
}

function validate(values) {
  const errors = {};
  if (!values.name) errors.name = "Enter your name";
  if (!values.email) errors.email = "Enter your email address";
  else if (!EMAIL.test(values.email)) errors.email = "Enter an email address in the format name@example.com";
  if (!values.message) errors.message = "Enter a message";
  return errors;
}

function render(messages) {
  list.replaceChildren(
    ...messages.map((m) => {
      const li = document.createElement("li");
      const who = document.createElement("strong");
      who.textContent = `${m.name} (${m.email})`;
      const topic = document.createElement("p");
      topic.className = "meta";
      topic.textContent = `Topic: ${m.topic}`;
      const body = document.createElement("p");
      body.textContent = m.message;
      li.append(who, topic, body);
      return li;
    }),
  );
  empty.hidden = messages.length > 0;
}

async function loadMessages() {
  try {
    const res = await fetch("/api/messages", { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    render((await res.json()).messages);
  } catch {
    empty.hidden = false;
    empty.textContent = "Your earlier messages couldn't be loaded. Reload the page to try again.";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  const values = Object.fromEntries(FIELDS.map((key) => [key, String(form.elements.namedItem(key).value).trim()]));
  const errors = validate(values);
  showErrors(errors);
  const count = Object.keys(errors).length;
  if (count > 0) {
    setStatus(`Your message wasn't sent: please fix ${count === 1 ? "1 problem" : `${count} problems`}.`, "error");
    return;
  }

  button.disabled = true;
  button.textContent = "Sending…";
  setStatus("Sending your message…");
  try {
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(values),
    });
    if (res.status === 201) {
      form.reset();
      setStatus("Message sent. We'll reply by email.", "ok");
      await loadMessages();
    } else if (res.status === 400) {
      const body = await res.json().catch(() => ({}));
      showErrors(body.errors ?? {});
      setStatus("Your message wasn't sent: please fix the highlighted fields.", "error");
    } else {
      setStatus("Sorry, your message couldn't be sent. Please try again in a moment.", "error");
    }
  } catch {
    setStatus("Sorry, your message couldn't be sent. Check your connection and try again.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Send message";
  }
});

loadMessages();
