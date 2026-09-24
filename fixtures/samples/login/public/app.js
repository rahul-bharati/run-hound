// Sign-in form: validates in the browser, signs in with fetch (JSON) to /api/session on this origin.
// Wrong credentials get a 401 and an announced error; the typed email and password are kept.
const form = document.getElementById("signin");
const email = document.getElementById("email");
const password = document.getElementById("password");
const toggle = document.getElementById("toggle");
const submit = document.getElementById("submit");
const alertBox = document.getElementById("alert");
const status = document.getElementById("status");
const account = document.getElementById("account");
const who = document.getElementById("who");
const signout = document.getElementById("signout");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fieldError(input, message) {
  document.getElementById(`${input.id}-error`).textContent = message;
  if (message) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

function showSignedIn(user) {
  form.hidden = user !== null;
  account.hidden = user === null;
  who.textContent = user?.email ?? "";
}

toggle.addEventListener("click", () => {
  const show = password.type === "password";
  password.type = show ? "text" : "password";
  toggle.setAttribute("aria-pressed", String(show));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submit.disabled) return;
  alertBox.textContent = "";
  const values = { email: email.value.trim(), password: password.value };
  const emailError = !values.email ? "Enter your email address" : EMAIL.test(values.email) ? "" : "Enter an email address in the format name@example.com";
  const passwordError = values.password ? "" : "Enter your password";
  fieldError(email, emailError);
  fieldError(password, passwordError);
  if (emailError || passwordError) {
    (emailError ? email : password).focus();
    return;
  }

  submit.disabled = true;
  submit.textContent = "Signing in…";
  try {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(values),
    });
    if (res.ok) {
      const body = await res.json();
      password.value = "";
      showSignedIn(body.user);
      status.textContent = `Signed in as ${body.user.email}.`;
      signout.focus();
    } else if (res.status === 401) {
      alertBox.textContent = "That email and password don't match an account. Check them and try again.";
    } else if (res.status === 400) {
      alertBox.textContent = "Enter your email address and password.";
    } else {
      alertBox.textContent = "Sorry, we couldn't sign you in right now. Please try again in a moment.";
    }
  } catch {
    alertBox.textContent = "Sorry, we couldn't reach the server. Check your connection and try again.";
  } finally {
    submit.disabled = false;
    submit.textContent = "Sign in";
  }
});

signout.addEventListener("click", async () => {
  try {
    await fetch("/api/session", { method: "DELETE" });
  } finally {
    showSignedIn(null);
    status.textContent = "You've signed out.";
    email.focus();
  }
});

fetch("/api/session", { headers: { accept: "application/json" } })
  .then((res) => (res.ok ? res.json() : { user: null }))
  .then((body) => showSignedIn(body.user ?? null))
  .catch(() => undefined);
