// Three independent parts: the header menu, the contact form (JSON to /api/messages, listed from GET /api/messages
// so messages survive a reload) and the newsletter form (JSON to /api/subscribe; the page never shows the address).
// The header search is a plain GET form: no JavaScript.
const $ = (id) => document.getElementById(id);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- header menu ---------------------------------------------------------------------------------------------
$("menu-toggle").addEventListener("click", () => {
  const open = $("menu-toggle").getAttribute("aria-expanded") === "true";
  $("menu-toggle").setAttribute("aria-expanded", String(!open));
  $("site-nav").hidden = open;
});

// ---- shared helpers ------------------------------------------------------------------------------------------
function setStatus(el, text, tone) {
  el.textContent = text;
  el.className = `status${tone ? ` is-${tone}` : ""}`;
}

function showErrors(form, fields, errors, errorId = (key) => `${key}-error`) {
  for (const key of fields) {
    const input = form.elements.namedItem(key);
    const message = errors[key] ?? "";
    $(errorId(key)).textContent = message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
  const first = fields.find((key) => errors[key]);
  if (first) form.elements.namedItem(first).focus();
}

async function postJson(url, body) {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
}

// ---- contact form --------------------------------------------------------------------------------------------
const contact = $("contact");
const send = $("send");
const FIELDS = ["name", "email", "order", "message"];

function render(messages) {
  $("messages").replaceChildren(
    ...messages.map((m) => {
      const li = document.createElement("li");
      const who = document.createElement("strong");
      who.textContent = `${m.name} (${m.email})`;
      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = m.order ? `Order: ${m.order}` : "No order number";
      const body = document.createElement("p");
      body.textContent = m.message;
      li.append(who, meta, body);
      return li;
    }),
  );
  $("empty").hidden = messages.length > 0;
}

async function loadMessages() {
  try {
    const res = await fetch("/api/messages", { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    render((await res.json()).messages);
  } catch {
    $("empty").hidden = false;
    $("empty").textContent = "Your earlier messages couldn't be loaded. Reload the page to try again.";
  }
}

$("refresh").addEventListener("click", () => loadMessages());

contact.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (send.disabled) return;
  const values = Object.fromEntries(FIELDS.map((key) => [key, String(contact.elements.namedItem(key).value).trim()]));
  const errors = {};
  if (!values.name) errors.name = "Enter your name";
  if (!values.email) errors.email = "Enter your email address";
  else if (!EMAIL.test(values.email)) errors.email = "Enter an email address in the format name@example.com";
  if (!values.message) errors.message = "Enter a message";
  showErrors(contact, FIELDS, errors);
  const count = Object.keys(errors).length;
  const status = $("status");
  if (count > 0) return setStatus(status, `Your message wasn't sent: please fix ${count === 1 ? "1 problem" : `${count} problems`}.`, "error");

  send.disabled = true;
  send.textContent = "Sending…";
  setStatus(status, "Sending your message…");
  try {
    const res = await postJson("/api/messages", values);
    if (res.status === 201) {
      contact.reset();
      setStatus(status, "Message sent. We'll reply by email.", "ok");
      await loadMessages();
    } else if (res.status === 400) {
      const body = await res.json().catch(() => ({}));
      showErrors(contact, FIELDS, body.errors ?? {});
      setStatus(status, "Your message wasn't sent: please fix the highlighted fields.", "error");
    } else {
      setStatus(status, "Sorry, your message couldn't be sent. Please try again in a moment.", "error");
    }
  } catch {
    setStatus(status, "Sorry, your message couldn't be sent. Check your connection and try again.", "error");
  } finally {
    send.disabled = false;
    send.textContent = "Send message";
  }
});

// ---- newsletter ----------------------------------------------------------------------------------------------
const news = $("newsletter");
const subscribe = $("subscribe");

news.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (subscribe.disabled) return;
  const email = String(news.elements.namedItem("email").value).trim();
  const errors = {};
  if (!email) errors.email = "Enter your email address";
  else if (!EMAIL.test(email)) errors.email = "Enter an email address in the format name@example.com";
  showErrors(news, ["email"], errors, () => "news-error");
  const status = $("news-status");
  if (errors.email) return setStatus(status, "You weren't subscribed: please fix the email address.", "error");

  subscribe.disabled = true;
  setStatus(status, "Subscribing…");
  try {
    const res = await postJson("/api/subscribe", { email });
    if (res.status === 201) {
      news.reset();
      setStatus(status, "Thanks! Check your inbox to confirm your subscription.", "ok");
    } else if (res.status === 400) {
      const body = await res.json().catch(() => ({}));
      showErrors(news, ["email"], body.errors ?? {}, () => "news-error");
      setStatus(status, "You weren't subscribed: please fix the email address.", "error");
    } else {
      setStatus(status, "Sorry, we couldn't subscribe you. Please try again in a moment.", "error");
    }
  } catch {
    setStatus(status, "Sorry, we couldn't subscribe you. Check your connection and try again.", "error");
  } finally {
    subscribe.disabled = false;
  }
});

loadMessages();
