# Run Hound: Product Strategy Report on Gaps in AI-Built Apps

*Scope: a defensive QA tool that tests only apps the user owns. This document covers categories, risks and product decisions. It does not include probing procedures.*

---

## 1. Executive summary

- **The need is real and well documented.**
  - Veracode found that 45% of AI-generated code samples fail security tests, and newer or larger models do no better.
  - Escape.tech scanned about 5,600 live vibe-coded apps from the outside and found 2,000+ vulnerabilities, 400+ exposed secrets and 175 PII exposures.
  - WebAIM Million 2026: accessibility is getting worse (95.9% of home pages fail), and WebAIM names "vibe coding" as a likely contributor.
  - WebGen-Bench: the best off-the-shelf agent passed only 27.8% of functional UI tests on the websites it generated.
- **Run Hound's outside-in approach is sound.** The most damaging real incidents were all visible from the browser: CVE-2025-48757 (missing Supabase RLS), secrets in JS bundles, and inverted or frontend-only access checks. The CVE itself was found by replaying the app's own network calls.
- **Every single piece already exists elsewhere.**
  - Platform scanners: Lovable, Bolt, Replit, v0.
  - External security scanners: Escape and a crowded, cheap long tail.
  - Accessibility rule engines: axe, Lighthouse.
  - Managed or SaaS end-to-end testing: QA Wolf, Momentic, testRigor.
  - Agentic Playwright generation: Playwright 1.56+ ships free planner, generator and healer agents.
- **The differentiated gap is the combination.** No verified tool offers all of this together: one local agent with your own choice of LLM, flow exploration, functional + accessibility + security checks in one pass, triage by priority in plain language, and export of portable Playwright specs.
- **The market for this category is unproven.** Octomind was the closest precedent and reportedly shut down in May 2026 for lack of market validation. That report is confirmed only through competitor pages and a dead domain.
- **Beachhead audience:** solo devs, small teams and QA testers, who can run Docker. Reach vibe coders later through a one-command or hosted mode, because a local Docker + Ollama setup doesn't fit their skills.
- **The biggest product risk is invented findings.** Non-technical users will trust a plain-language defect report. Only report a defect when there is reproducible evidence: a screenshot, the request and response, and a spec that replays it.
- **Top recommendation for V0:** a deterministic check pack for a single form. Build on Playwright and @axe-core/playwright, and use the LLM only for planning and explanation, not for deciding verdicts. The pack covers:
  - dead submit
  - silent failure
  - double submit
  - persistence on reload
  - axe checks in every form state
  - keyboard completion of the form
  - error announcement
  - secret patterns in the bundle
  - PII leaking to third parties

---

## 2. Market need and competition

### 2.1 Evidence of need

| Claim | Strength | Source |
|---|---|---|
| 45% of code samples from 100+ LLMs failed security tests. XSS defenses failed in 86% of relevant samples. Results stayed flat as models grew. | Strong | veracode.com/blog/genai-code-security-report |
| About 5,600 live vibe-coded apps scanned purely from outside: 2,000+ vulnerabilities, 400+ secrets, 175 PII exposures. The landing page says ~1,400 apps; cite the methodology post. | Strong | escape.tech methodology post (Oct 29, 2025) |
| CVE-2025-48757 (CVSS 8.26): insufficient RLS in Lovable projects. Secondary reporting puts it at 170 of 1,645 apps (10.3%) and 303 endpoints, found by replaying calls from outside. | Strong | mattpalmer.io |
| Stack Overflow 2025: 84% use or plan to use AI. 46% distrust its accuracy, 3% highly trust it, and 66% name "almost right" as their top frustration. | Strong | survey.stackoverflow.co/2025/ai |
| WebAIM Million 2026: 95.9% of home pages fail, averaging 56.1 errors per page (+10.1%). Vibe coding is named as a likely driver. | Strong | webaim.org/projects/million |
| AI-authored PRs had about 1.7x more issues, and error-handling gaps were about 2x more common. The source is a vendor with an interest in AI review. | Moderate | coderabbit.ai report (Dec 2025) |
| DORA 2025: AI adoption still correlates with lower delivery stability, and the bottleneck moves to testing and QA. | Moderate | cloud.google.com DORA 2025 |
| Lovable reports $500M ARR, 1M projects a week, and mostly non-technical users. The figures are self-reported. | Moderate | techcrunch.com (Jun 2026) |
| 28% of developers say fixing AI code cancels out most of the time it saved. | Moderate | fastly.com survey (Jul 2025) |
| Lovable's own docs say its static scans miss runtime issues and sell a dynamic pentest on top. | Moderate | docs.lovable.dev/integrations/aikido |
| axe catches about 57% of accessibility issues by volume. This is Deque's own 2021 figure. | Weak | deque.com |

**Incidents to cite correctly:**

- **CVE-2025-48757 (Lovable, RLS):** a valid example.
- **Lovable Discover app, 18,697 records:** caused by an inverted access-check function. It is not an RLS example.
- **Replit/SaaStr production DB deletion:** relevant to Run Hound's *own* safety guardrails.
- **Base44 and the Lovable BOLA regression:** platform bugs, not flaws in the apps' own code.
- **Tea app:** do not cite as vibe-coding evidence. It was a legacy system. Use it only as an example of an open BaaS bucket.

### 2.2 Competitors

| Tool | What it does | Gap left for Run Hound |
|---|---|---|
| Lovable Security Checker, scans, Aikido pentest | Static checks for secrets and RLS, plus a paid dynamic pentest | Security only and locked to Lovable. No functional, accessibility or Playwright export. The platform that sets the defaults is also the one grading them. |
| Bolt security audit on publish | Free static code review with auto-fix. Bolt itself calls it "a first pass" | Never runs the app. No UX, accessibility or test artifacts. Bolt only. |
| Replit Security Center | SAST and dependency scanning before deploy (Semgrep, HoundDog.ai) | Static only. **Name conflict risk: "HoundDog.ai" vs "Run Hound", so check trademarks.** |
| v0 (Vercel) | Security checks at generation time | Nothing re-verifies after the user edits or connects a backend |
| Escape.tech and the vibe-scanner long tail | External DAST and ASM, bundle secret scanning, RLS and header checks | Security only, cloud-hosted, commoditised. No functional flows or test export. |
| QA Wolf | Managed AI + human Playwright suites | About $8k+/month (third-party estimate), out of reach for solo devs |
| Momentic | Natural-language E2E, self-healing, metered credits | Cloud only, vendor LLM, proprietary format, no security or accessibility triage |
| testRigor | Plain-English E2E authoring | Enterprise pricing (~$1.8k/month, third-party figure). You still write the tests yourself. |
| Meticulous / Checksum | Tests generated from real user sessions and traffic | Useless before launch, when there is no traffic yet |
| Reflect (SmartBear) | No-code E2E | Enterprise cloud product |
| Octomind (reportedly defunct) | Agentic discovery plus Playwright export | A warning sign: the closest precedent failed to find a paying market |
| **Playwright Test Agents / MCP** | Free, first-party planner, generator and healer. Works with any LLM. | **Biggest threat.** Aimed at developers in an IDE: no approval UI, triage, security or accessibility lens, plain-language explanations or sandbox. **Build on it.** |
| Browser Use / Stagehand / Shortest | Open-source LLM browser-automation libraries | Libraries, not products. Candidate driver layer. |
| axe-core / Lighthouse / WAVE | Accessibility rule engines | Check one page state at a time, never walk flows, no keyboard task completion. **Embed axe.** |
| ZAP / Burp | DAST proxies | Noisy, hard for non-experts, blind to app semantics such as who should see which row. ZAP could run as a passive sidecar. |

### 2.3 Counterarguments and responses

| Counterargument | How Run Hound should respond |
|---|---|
| Platforms are building security in (Lovable, Bolt, Replit, v0) | Position as the **independent runtime verifier**. Platform static scans missed real exposures, and Lovable's first scan only checked that a policy existed. Also cover what platforms don't: functional and accessibility testing, plus portable specs. |
| Vibe coders won't run Docker or Ollama | Lead with solo devs, small teams and QA testers. Add a single-command launcher, then a hosted mode, before targeting vibe coders. |
| Octomind died, and AI E2E is hard to sell | Don't sell "AI writes your E2E tests". Sell "find what's broken, insecure or inaccessible before users do", with test export as a bonus. Validate willingness to pay early. |
| Playwright agents are free and first-party | Build on them. Differentiate on the outcome layer: approval UI, triage, security and accessibility checks, plain-language fixes, sandboxing. |
| The vibe-scanner space is commoditised | Security is one lens of three, not the headline. The combined report is the product. |
| Local LLM quality is low (7-8B web agents fail ~1 in 4 tasks) | Keep verdicts deterministic: rules, network assertions, axe. The LLM plans and explains. Every finding needs evidence plus a replay. |
| LLM-driven tests are flaky, and self-healing hides regressions | Exported specs must use stable role- or label-based locators and must not depend on the agent at runtime. No silent self-heal in exported tests. |
| Black-box limits: authorization bugs need two identities, and server logic is invisible | Provide guided setup for two owned test accounts. Report "not tested / not visible from outside" explicitly so the report gives no false assurance. |
| Only about a quarter of devs vibe code | That is a reason to lead with the pro-dev and QA segments, not vibe coders. |
| Liability: an agent could damage live data (Replit/SaaStr) | Localhost first. Destructive actions opt-in. Domain verification for V4. Warn when staging appears to share production data. Throttle bursts. |
| Cloud LLM costs on vision-heavy runs | Use the a11y tree and DOM first, with screenshots only on demand. Deterministic checks cost no tokens. |

---

## 3. Gap catalog

Verdict key: **C** = confirmed, **PC** = partially confirmed (corrections applied), **U** = unchecked or unverifiable, **M** = missed by the original research and added by the checker.

### 3.1 Security

| Issue | Severity | Browser-detectable | Detection signal | Verdict |
|---|---|---|---|---|
| Supabase tables reachable with the public key (RLS off or `USING (true)`) | Critical | Yes (confirming needs owned test accounts) | Compare anonymous vs two owned test accounts on the app's own data calls | PC: the 170/1,645 figure comes from secondary reporting. CVSS 8.26. RLS is on by default for tables made in the Dashboard; tables made via SQL or migrations need it enabled explicitly. |
| Firebase rules left open (test mode or allow-all) | Critical | Yes | Anonymous vs owned-account access comparison | PC: Tea is an open-bucket example, not a vibe-coding one. Test mode expires after 30 days, so the real failure is replacing it with allow-all. |
| Third-party secret keys in the client bundle | Critical | Yes | Bundle scan for key patterns (exclude publishable keys) | C: GitGuardian's figure is about repos, not bundles |
| Supabase service_role key in the browser | Critical | Yes | Bundle scan, with a check of the key's role claim | C |
| Auth enforced only in the frontend | Critical | Yes | Owned APIs respond without a session; credential strings in bundle | PC: the Register 18,697 case goes under "broken access check" |
| IDOR / BOLA | Critical | Yes (needs 2 accounts) | Compare two owned test accounts | PC: the Lovable case is disputed |
| Admin or internal pages public without auth | High | Yes | Unauthenticated crawl of the owned app | C |
| Paywall on the client; success page trusted | High | Partial | Paid state reachable without payment confirmation | C: Enrichlead is semi-anecdotal |
| No rate limiting on auth, OTP or LLM endpoints | High | Yes | Small bounded burst, watch for throttling | C |
| Server trusts client fields (mass assignment) | High | Partial | Server accepts values the form rejects | C: detectability downgraded to partial |
| XSS via raw HTML or rendered LLM output | High | Yes | Benign canary rendering check | C |
| Permissive CORS with credentials | High | Yes | CORS response check from a second local origin | C |
| Prompt injection in chatbots and AI features | High | Partial | Canned injection probes on the owned chatbot | C |
| Staging wired to the production DB (tester safety) | High | Partial | Environment fingerprint and warning before danger paths | PC: Replit dev/prod separation announced (Register follow-up) |
| Known-vulnerable Next.js / React RSC versions | Critical | Partial | Version fingerprint mapped to CVEs | PC: Vercel and Netlify are not affected by CVE-2025-29927. "Many AI apps put all auth in middleware" is unsourced. |
| Missing security headers | Medium | Yes | Response header check | PC: no vibe-coding-specific source |
| Cookie flags missing; tokens in localStorage | Medium | Yes | Cookie attribute and storage inspection | C: lower severity when an SDK stores tokens by default |
| Verbose errors and public source maps | Medium | Yes | Error-response and source-map presence check | C |
| Open redirects in login flows | Medium | Yes | Redirect-parameter allowlist check | **U: unchecked, no prevalence source** |
| Hallucinated or slopsquatted dependencies | Medium | No | Lockfile analysis (static companion) | C: split from third-party script risk |
| Cross-cutting: AI code is less secure and its authors overconfident | High | n/a | n/a (supports the need) | C: Perry et al. is dated and small (n=47); Veracode Spring 2026 is fresher |

**Missed by the original research (M):**

| Issue | Browser-detectable |
|---|---|
| CSRF on cookie-auth apps | Yes (second local origin) |
| Supabase RPC functions and public storage buckets reachable with the public key | Yes |
| Exposed dotfiles and build artifacts | Yes |
| Unrestricted file upload (SVG/HTML served inline) | Yes |
| SSRF in "import from URL" features | Partial (canary) |
| Auth-flow weaknesses: user enumeration, weak policy, logout not revoking sessions, open signup | Yes |
| JWT not verified | Yes |
| Third-party scripts without SRI (polyfill.io class) | Yes |
| Additional RSC CVEs (CVE-2025-55183 and CVE-2025-55184) | Partial (fingerprint) |
| Positioning: Supabase Security Advisor and Lovable scans already cover part of this | n/a |

### 3.2 Accessibility

| Issue | Severity | Browser-detectable | Detection signal | Verdict |
|---|---|---|---|---|
| Clickable div or span instead of a button | Critical | Yes | Pointer cursor but not focusable, plus keyboard activation diff (event delegation defeats per-element listener checks) | C |
| Icon-only controls with no accessible name | High | Yes | axe-core rule (button-name, link-name) | PC: cite Suh et al. and scope the A11YN counts to the Qwen 7B base model |
| Inputs without labels, or placeholder as the only label | High | Yes | axe-core rule and label-association check | C |
| Low text or UI contrast, including hover, focus and dark states | High | Partial | axe contrast rule in each state | PC: the 80% share applies to the whole AChecker dataset |
| Focus indicator removed | High | Yes | Keyboard traversal with before/after focus-style diff | C: 2.4.7 is the main criterion |
| Modals not managing focus; unnamed dialogs | High | Yes | Keyboard traversal while the modal is open and after it closes | C: the Radix warning appears only in dev mode |
| ARIA misuse | High | Partial | axe ARIA rules plus behaviour checks | C: the WebAIM ARIA link is a correlation |
| Custom widgets unusable by keyboard | High | Yes | Keyboard traversal against APG patterns | PC: 2.5.7 requires a single-pointer alternative |
| Validation errors and status updates not announced | High | Yes | aria-invalid, describedby and live-region check after submit | C |
| Relying on automated scores or overlays for "compliance" | High | Partial | Overlay script detection plus disclosure of coverage limits | PC: FTC order finalized April 2025; the French actions were emergency injunctions |
| Missing or meaningless alt text | Medium | Partial | axe rule plus an LLM judgment (advisory) | C |
| Generic link and button text | Medium | Partial | Duplicate accessible-name detection | C: 2.4.4 allows context. Strict failures are 2.4.9 (AAA). |
| Broken heading hierarchy and landmarks | Medium | Yes | axe best-practice rules | C: best practice, not a 1.3.1 failure |
| SPA route changes not announced | Medium | Yes | Title and focus check after navigation | PC: Next.js announces routes by default |
| Missing or wrong html lang | Medium | Yes | axe-core rule | C |
| Focus hidden under sticky elements | Medium | Yes | Compare focused element's position with overlays during traversal | C |
| Targets smaller than 24×24 px | Medium | Yes | axe target-size rule | C |
| Layout breaks at 320px or 200-400% zoom | Medium | Yes | Viewport reflow and overflow check | C: tables and maps are exempt |
| Login or OTP fields that block paste | Medium | Yes | Paste event check on credential fields | C: autocomplete=off alone does not fail |
| No skip link, or a broken one | Low | Yes | Skip-link target check | PC: missing skip link fails only when there are also no landmarks or headings |
| Animations ignore reduced motion | Low | Yes | Reduced-motion emulation diff | C: the A-level risk is 2.2.2 |

**Missed by the original research (M):**

- Label in Name mismatch (axe experimental rule)
- Missing or invalid autocomplete on personal-data fields (1.3.5)
- Illogical focus order or positive tabindex (compare with the visual order)
- Hover or focus popups that can't be dismissed (1.4.13)
- Layout breaks under text-spacing override (1.4.12)
- Session timeouts without warning (2.2.1)
- Redundant entry and inconsistent help (WCAG 2.2, V2+)
- Page title missing, template default or duplicated
- Media without captions; autoplaying audio
- Blind spots: canvas, closed shadow DOM, cross-origin iframes. **Report these as unscanned.**
- ADA Title II web rule (legal context)

### 3.3 Broken features

| Issue | Severity | Browser-detectable | Detection signal | Verdict |
|---|---|---|---|---|
| Features that look saved but aren't persisted | Critical | Yes | Reload and re-read after a write | PC: prevalence unsourced |
| Payment access granted from the redirect page | Critical | Partial | Paid state reachable without verified payment | C: Stripe recommends landing page plus webhook |
| OAuth or magic link redirects to localhost | Critical | Yes | Final URL of the auth redirect chain | C |
| Buttons, links and menu items that do nothing | High | Yes | No request, DOM change or navigation after activation | PC: Tambon et al. (not Tao). WebGen-Bench best off-the-shelf 27.8%, fine-tuned 38.2%. |
| Forms that fail silently | High | Yes | Network fault injection on the owned app, expecting a visible error | C |
| Double submit creates duplicates | High | Yes | Rapid double activation, then count the requests | C: the Stripe quote is about the backend |
| Placeholder or demo data shipped as real | High | Partial | Seed-data heuristics and identical output across accounts | PC: use the verbatim Register quote |
| Password reset and verification broken in prod | High | Partial | Auth email flow run with an owned inbox | PC: the real error string is "Verify requires a token or a token hash" |
| Refresh, deep links and Back break on SPA routes | High | Yes | Direct load and reload of each discovered route | C |
| Production config missing (localhost or undefined API URLs) | High | Yes | Console/network error capture plus request-host check | C |
| Broken mobile layouts; zoom blocked | High | Yes | Mobile viewport run plus viewport meta check | C |
| Regressions from AI edits | High | Partial | Re-run exported specs as a regression suite | C: at least 23 of 26 audited apps had no working tests |
| Code calls functions or endpoints that don't exist | High | Yes | Console/network error capture | PC: Tambon et al. |
| Missing loading and empty states | Medium | Yes | Throttled network run plus a fresh empty account | PC |
| Out-of-order responses show stale data | Medium | Yes | Latency injection, then check results match the latest query | C |
| Dead links and missing assets | Medium | Yes | Link and asset crawl | C: Pew data is web-wide |
| SSR hydration mismatches | Medium | Yes | Console hydration-error capture | C |
| Timezone and locale bugs | Medium | Yes | Run under alternate timezone and locale emulation | C |
| Search, sort and pagination only work on the happy path | Medium | Partial | Boundary and special-character inputs; last-page state | PC |
| "AI says it's done" with no independent check | High | Partial | n/a (the product thesis) | PC: METR devs forecast +24% speedup and estimated +20% afterwards, but were actually 19% slower |

**Missed by the original research (M):**

- Stale chunks after a deploy
- Upload size limits failing silently (e.g. 413)
- Validation that exists only on the client
- Token expiry partway through a flow
- Breakage in Safari (WebKit) or Firefox
- Custom controls that can't be operated by keyboard (overlaps with accessibility)

### 3.4 Non-technical blind spots

Items that duplicate earlier sections are only cross-referenced here.

| Issue | Severity | Browser-detectable | Detection signal | Verdict |
|---|---|---|---|---|
| Open BaaS (see Security) | Critical | Partial | See Security | PC |
| Access control only in the browser (see Security) | Critical | Partial | See Security | C: Base44 was a platform flaw |
| Runaway LLM or API bills | High | Partial | Bounded burst on AI endpoints plus bundle key scan | C |
| Not knowing which env vars become public | High | Yes | Bundle scan (flag secrets, whitelist publishable keys) | C: add a false-positive note |
| Dev/prod confusion: localhost URLs, test keys, mixed content | High | Partial | Request-host check, test-mode key detection, mixed-content console | PC |
| No database backups | High | No | Checklist companion | C |
| Trackers fire before or despite consent | High | Yes | Third-party requests before consent and after Reject | PC: study-dependent figures; cite the primary studies |
| PII leaking to analytics and pixels | High | Yes | Canary value (and its hashes) found in third-party requests | C |
| No privacy policy or account deletion | Medium | Partial | Link and flow presence check | C: Apple 5.1.1(v) requires in-app deletion |
| Invisible to search and social (SPA, noindex, no OG tags) | Medium | Yes | Fetch without JS, then check meta, robots and status | C |
| Slow pages (Core Web Vitals) | Medium | Yes | Lighthouse lab metrics | C: lab data, not field data |
| Transactional email not delivered (SPF, DKIM, DMARC) | Medium | Partial | DNS record check (companion) | C: DKIM selector can't be discovered from outside |
| No error monitoring | Medium | Partial | Monitoring SDK presence (advisory) | PC |
| Works in Chrome only | Medium | Yes | Cross-engine rerun | PC: Playwright WebKit on Linux only approximates Safari |
| Outdated framework CVEs (see Security) | Critical | Partial | Version fingerprint | C |
| Public source maps (see Security) | Medium | Yes | Source-map presence check | C |
| Headers and cookie flags (see Security) | Medium | Yes | Response header and cookie check | PC |
| Accessibility plus legal exposure (EAA) | High | Yes | See Accessibility | C: EAA covers specific sectors; the microenterprise exemption applies to services only |
| Success-page fulfilment (see Broken features) | High | Partial | See Broken features | C |
| Hallucinated deps and code ownership | Medium | No | Checklist companion | C: 19.7% average is driven by open models (commercial 5.2%); copyright guidance is US-only |

**Missed by the original research (M):**

- service_role or secret keys in the client (covered in Security)
- IDOR in custom APIs
- No bot protection on signup or contact forms
- Exposed dotfiles
- Public upload buckets
- Auth provider misconfiguration (verification off, open signup)
- Preview or staging URLs publicly indexed

---

## 4. Scope mapping

**V0: single form on localhost.** These picks are cheap, deterministic and high-signal.

- **Functional:**
  - dead submit
  - silent failure (fault injection)
  - double submit
  - persistence on reload
  - console/network error capture
  - calls to missing functions or endpoints
- **Accessibility (on the form):**
  - labels
  - accessible names
  - contrast in every state
  - focus visible
  - keyboard completion
  - error and status announcement
  - paste blocking on credentials
  - autocomplete purpose
  - target size
  - reflow at 320px
  - Label in Name
- **Security and privacy:**
  - bundle scan for secret key patterns, including service_role
  - canary PII leaking to third parties or the URL
  - V0 stretch: client-only validation (server accepts values the form rejects)

**V1: single page.**

- Full-page axe checks: headings, landmarks, lang, alt, skip link, generic link text, duplicated or template page title
- Icon-button names
- Modal and dialog focus
- Custom widgets against APG patterns
- Focus hidden under sticky elements
- Reduced motion and text spacing
- Hover popups
- Dead links and assets on the page
- Hydration errors
- Mobile layout and zoom blocking
- Loading and empty states under throttling
- Stale responses (race conditions)
- Timezone and locale emulation
- Headers and cookie flags (against a production-like build)
- Public source maps
- Framework version to CVE fingerprint
- Third-party scripts and SRI inventory
- Anonymous-access check on the app's own BaaS calls
- Tracking before consent
- XSS canary on inputs rendered on the page

**V2: single feature end to end.**

- Authorization checks with two owned test accounts: RLS, Firebase rules, IDOR, frontend-only auth, mass assignment, RPC and storage buckets
- Paywall and success-page trust
- Auth flows: OAuth redirect, reset, verification, enumeration, logout revocation, JWT verification, token expiry mid-flow
- Bounded rate-limit check on auth and AI endpoints
- CSRF
- File upload handling
- SPA deep links, reload and Back
- SPA route announcements
- Placeholder or demo-data heuristics
- Search, sort and pagination boundaries
- Redundant entry
- Session timeouts
- Prompt-injection probes on owned chatbots

**V3: whole app.**

- Unauthenticated route crawl (public admin pages)
- Site-wide link and asset crawl
- Consistent help
- Cross-engine reruns (WebKit, Firefox)
- Core Web Vitals
- Search and social visibility (no-JS fetch)
- Privacy policy and account-deletion presence
- Regression re-runs of exported specs across AI edits
- Stale chunks after deploy
- Upload size limits
- Coverage-blind-spot disclosure across the whole app
- Overlay detection

**V4+ (live staging behind domain verification):**

- Staging wired to production (safety gate)
- Exposed dotfiles and backups on the real host
- CORS from an external origin
- Open redirects (after the claim is verified)
- Real host security headers
- Localhost URLs and test-mode keys in the deployed build
- Mixed content
- Preview URLs indexed
- SSRF with out-of-band canaries
- Transactional email delivery

**Out of scope: checklist or static companion.**

- Database backups
- Hallucinated or slopsquatted dependencies (lockfile analysis)
- SPF, DKIM and DMARC DNS records
- Backend error monitoring
- AI code copyright
- Webhook signature verification (server-side)
- Legal compliance judgement (EAA, ADA). Run Hound reports WCAG failures; it does not certify compliance.

---

## 5. Plain-language explanations

**1. Your database is readable by anyone (Supabase RLS or Firebase rules open)**

- **What this means:** The key in your website's code is meant to be public. The rules that stop strangers reading other people's data are missing or say "allow everyone".
- **Why it matters:** Anyone can download all of your users' data, or change it. This caused CVE-2025-48757 in about 10% of sampled Lovable apps.
- **What to ask your AI to fix:** "Enable Row Level Security on every table and write policies so each user can only read and write their own rows. Show me each policy and explain who it allows."

**2. A secret key is shipped to every visitor**

- **What this means:** A private key (for example OpenAI, Stripe secret, or the Supabase service_role key) is inside the JavaScript your site sends to browsers.
- **Why it matters:** Anyone can spend your API credits, send email as you, or get full admin access to your database.
- **What to ask your AI to fix:** "Move this API call to a server function, read the key from a server-only environment variable, remove the public prefix, and tell me which keys I must rotate now."

**3. Login or admin checks only happen in the page**

- **What this means:** The page hides admin buttons or redirects logged-out users, but the server answers anyone who asks directly.
- **Why it matters:** Hiding a button is not security. Protected data and admin actions are open to everyone.
- **What to ask your AI to fix:** "Enforce authentication and role checks on the server for every protected endpoint, not just in the UI. List the endpoints you changed."

**4. One user can see another user's records (IDOR)**

- **What this means:** When your app asks for "item 123", the server returns it without checking that it belongs to the person asking.
- **Why it matters:** Customers can see or change each other's orders, profiles or messages.
- **What to ask your AI to fix:** "For every endpoint that takes an ID, check on the server that the logged-in user owns that record, and return 404 if they don't."

**5. The form fails silently**

- **What this means:** When saving fails, the form shows nothing, spins forever, or pretends it worked.
- **Why it matters:** People think they signed up or ordered when they didn't, and you lose them without ever knowing.
- **What to ask your AI to fix:** "Handle every error from this form's request, including timeouts and offline, with a clear visible message that screen readers announce, and keep the user's input."

**6. It looks saved but isn't**

- **What this means:** The screen updates right away, but the change never reaches your database, so it disappears on reload.
- **Why it matters:** Users lose work, and you only find out from angry emails.
- **What to ask your AI to fix:** "Make sure this save actually writes to the backend, only show success after the server confirms, and roll back the UI if it fails."

**7. Double-clicking creates duplicates**

- **What this means:** The submit button stays active while the request is in flight, so two clicks send two orders.
- **Why it matters:** Duplicate charges, refunds and messy data.
- **What to ask your AI to fix:** "Disable the submit button while the request is pending, and make the server endpoint idempotent so repeated requests don't create duplicates."

**8. The form can't be used with a keyboard or screen reader**

- **What this means:** Fields have no labels, buttons are really clickable boxes, or the focus outline was removed. People who don't use a mouse can't complete the form.
- **Why it matters:** You exclude disabled users (and power users), and you may have legal exposure under the EAA or ADA.
- **What to ask your AI to fix:** "Use real button and label elements, give every icon button an aria-label, restore a visible focus style, and make sure the whole form can be completed with Tab, Enter and Space."

**9. Errors aren't announced**

- **What this means:** Red error text appears, but it isn't linked to the field or announced to assistive technology.
- **Why it matters:** Blind users submit, hear nothing, and give up.
- **What to ask your AI to fix:** "On validation errors, set aria-invalid on the field, link the message with aria-describedby, announce a summary in a live region, and move focus to the first invalid field."

**10. Personal data leaks to analytics or ad trackers**

- **What this means:** What users type (email, name, search terms) ends up in the URL or in data sent to trackers.
- **Why it matters:** Privacy law violations. The FTC has fined companies for this, for example GoodRx.
- **What to ask your AI to fix:** "Submit this form with POST, keep personal data out of URLs and page titles, and turn off automatic form-field capture in our analytics and pixel scripts."

**11. Login redirects to localhost in production**

- **What this means:** Your auth provider still has your development address configured, so users land on a dead page after logging in.
- **Why it matters:** Nobody can log in, and no error message appears.
- **What to ask your AI to fix:** "Set the auth Site URL and redirect allow-list to our production domain, and list every place a redirect URL is configured."

---

## 6. Recommended V0 checklist and deferrals

### 6.1 V0 checklist, in order

Every check runs deterministically. The LLM plans scenarios and writes explanations but never decides pass or fail.

1. **Console and network error capture** for the whole form session. This is the baseline evidence for every other check.
2. **Dead control:** submit or any button produces no request, no DOM change and no navigation.
3. **Silent failure:** inject a server error, a timeout and an offline state on the owned app, and expect a visible, announced error with the input kept.
4. **Persistence:** after a successful submit, reload and confirm the data is still there (only if the form creates or edits data).
5. **Double submit:** rapid double activation, then count the requests and check the button's disabled state.
6. **axe-core on every form state** (initial, invalid, server error, success): labels, accessible names, contrast, ARIA, target size.
7. **Keyboard completion:** traverse and submit using only the keyboard. Check that focus is visible, that there is no trap, and that focus order is logical.
8. **Error announcement:** aria-invalid, describedby and live region after an invalid submit.
9. **Credential and personal fields:** paste allowed on password and OTP fields; autocomplete purpose present; Label in Name matches.
10. **Bundle scan for secret key patterns**, including the service_role role claim. Whitelist publishable keys to avoid false alarms.
11. **Canary PII leak:** a canary value (and its hashes) must not show up in third-party requests or the URL.
12. **Reflow at 320px** for the form.
13. *(Stretch)* **Client-only validation:** the server accepts a value the form rejects. Only non-destructive values, only on localhost.

Product guardrails that ship with V0:

- Every finding carries evidence (a screenshot and/or the request and response) plus a replayable exported spec.
- Exported specs use role- and label-based locators, with no agent at runtime.
- An "Unscanned / not visible from outside" section in every report.
- Destructive actions are off by default.

### 6.2 What to defer, and why

- **Checks that need two owned test accounts** (RLS, Firebase rules, IDOR, frontend-only auth, mass assignment) → V2. They carry the highest severity, but need account setup and multi-step flows. Make this the V2 headline feature, since it confirms findings instead of guessing.
- **Headers, cookie flags, CORS, source maps, CVE fingerprinting** → V1 or V4. Localhost dev servers don't show production values, so results would mislead.
- **Rate-limit bursts, prompt injection, SSRF, file upload** → V2+. They need careful throttling and opt-in, and have more side effects.
- **Alt-text quality, generic labels, placeholder-data detection** → V1+, as advisory only. They rely on LLM judgement and must not be reported as confirmed defects.
- **Cross-browser, Core Web Vitals, SEO and social previews, dead-link crawl** → V3. These are whole-app concerns.
- **Live-host checks** (dotfiles, staging-to-prod detection, mixed content, email DNS) → V4, behind domain verification.
- **Backups, dependency lockfiles, webhook signatures, legal certification** → checklist or static companion, never browser checks.

---

## 7. Sources

**Security**

- https://mattpalmer.io/posts/2025/05/CVE-2025-48757/
- https://mattpalmer.io/posts/statement-on-CVE-2025-48757/
- https://mattpalmer.io/posts/2025/05/statement-on-CVE-2025-48757/
- https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys
- https://www.wiz.io/blog/common-security-risks-in-vibe-coded-apps
- https://www.wiz.io/blog/critical-vulnerability-base44
- https://thehackernews.com/2025/07/wiz-uncovers-critical-access-bypass.html
- https://www.theregister.com/2026/02/27/lovable_app_vulnerabilities/
- https://www.theregister.com/security/2026/04/21/lovable-denies-data-leak-cites-intentional-behavior/5226233
- https://lovable.dev/blog/our-response-to-the-april-2026-incident
- https://thenextweb.com/news/lovable-vibe-coding-security-crisis-exposed
- https://supabase.com/docs/guides/database/secure-data
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/database/database-advisors
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/api/api-keys
- https://supabase.com/docs/guides/storage/buckets/fundamentals
- https://www.superblocks.com/blog/lovable-vulnerabilities
- https://cursorguard.com/blog/170-lovable-apps-breach/
- https://env.fail/posts/firewreck-1/
- https://firebase.google.com/docs/rules/insecure-rules
- https://escape.tech/blog/methodology-how-we-discovered-vulnerabilities-apps-built-with-vibe-coding/
- https://escape.tech/state-of-security-of-vibe-coded-apps
- https://escape.tech/
- https://arxiv.org/abs/2603.12498
- https://www.csoonline.com/article/3953927/ai-programming-copilots-are-worsening-code-security-and-leaking-more-secrets.html
- https://redhuntlabs.com/blog/echoes-of-ai-exposure-thousands-of-secrets-leaking-through-vibe-coded-sites-wave-15-project-resonance/
- https://www.intruder.io/research/secrets-detection-javascript
- https://github.com/OWASP/API-Security/blob/master/editions/2023/en/0xa1-broken-object-level-authorization.md
- https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/
- https://github.com/OWASP/API-Security/blob/master/editions/2023/en/0xa3-broken-object-property-level-authorization.md
- https://github.com/OWASP/API-Security/blob/master/editions/2023/en/0xa4-unrestricted-resource-consumption.md
- https://github.com/OWASP/API-Security/blob/master/editions/2023/en/0xa7-server-side-request-forgery.md
- https://top10.owasp.org/2025
- https://top10.owasp.org/2025/A01_2025-Broken_Access_Control/
- https://owasp.org/www-community/attacks/SMS_Pumping
- https://owasp.org/www-project-automated-threats-to-web-applications/
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/04-Review_Old_Backup_and_Unreferenced_Files_for_Sensitive_Information
- https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/checkout/fulfillment
- https://docs.stripe.com/checkout/fulfillment.md?payment-ui=stripe-hosted
- https://snyk.io/articles/the-highs-and-lows-of-vibe-coding/
- https://www.synack.com/exploits-explained/client-side-authentication-bypass-3-real-world-pentesting-case-studies/
- https://www.veracode.com/blog/genai-code-security-report/
- https://www.veracode.com/resources/analyst-reports/2025-genai-code-security-report/
- https://www.veracode.com/blog/spring-2026-genai-code-security/
- https://www.businesswire.com/news/home/20250730694951/en/
- https://react.dev/reference/react-dom/components/common
- https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components
- https://almanac.httparchive.org/en/2025/security
- https://almanac.httparchive.org/en/2025/cookies
- https://portswigger.net/web-security/cors
- https://blog.sentry.security/abusing-exposed-sourcemaps/
- https://securitylabs.datadoghq.com/articles/nextjs-middleware-auth-bypass/
- https://securitylabs.datadoghq.com/articles/cve-2025-55182-react2shell-remote-code-execution-react-server-components/
- https://projectdiscovery.io/blog/nextjs-middleware-authorization-bypass
- https://www.cisa.gov/news-events/alerts/2025/12/05/cisa-adds-one-known-exploited-vulnerability-catalog
- https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/
- https://incidentdatabase.ai/cite/622/
- https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- https://arxiv.org/abs/2406.10279
- https://www.aikido.dev/blog/slopsquatting-ai-package-hallucination-attacks
- https://socket.dev/blog/slopsquatting-how-ai-hallucinations-are-fueling-a-new-class-of-supply-chain-attacks
- https://sansec.io/research/polyfill-supply-chain-attack
- https://arxiv.org/abs/2211.03622
- https://developers.google.com/maps/api-security-best-practices

**Incidents**

- https://incidentdatabase.ai/cite/1152/
- https://www.theregister.com/2025/07/21/replit_saastr_vibe_coding_incident/
- https://www.theregister.com/2025/07/22/replit_saastr_response/
- https://x.com/amasad/status/1946986468586721478
- https://fortune.com/2025/07/23/ai-coding-tool-replit-wiped-database-called-it-a-catastrophic-failure/
- https://www.engadget.com/cybersecurity/tea-app-suffers-breach-exposing-thousands-of-user-images-190731414.html
- https://www.nbcnews.com/tech/social-media/tea-app-hacked-13000-photos-leaked-4chan-call-action-rcna221139
- https://techcrunch.com/2025/07/26/dating-safety-app-tea-breached-exposing-72000-user-images
- https://simonwillison.net/2025/Jul/26/official-statement-from-tea/

**Accessibility**

- https://webaim.org/projects/million/
- https://webaim.org/projects/million/2025
- https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/button_role
- https://legacy.reactjs.org/blog/2020/08/10/react-v17-rc.html#changes-to-event-delegation
- https://chromedevtools.github.io/devtools-protocol/tot/DOMDebugger/#method-getEventListeners
- https://arxiv.org/html/2510.13914v1
- https://arxiv.org/html/2503.15885v1
- https://tommasocalo.github.io/papers/26-semacces-chiea.pdf
- https://dl.acm.org/doi/10.1145/3772363.3799364
- https://tailwindcss.com/docs/outline-style
- https://github.com/noahweidig/noahweidig.github.io/issues/54
- https://github.com/shadcn-ui/ui/issues/4302
- https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
- https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/
- https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html
- https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html
- https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
- https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html
- https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
- https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
- https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html
- https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html
- https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html
- https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html
- https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html
- https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html
- https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html
- https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html
- https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html
- https://www.w3.org/WAI/WCAG22/Understanding/audio-control.html
- https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html
- https://dequeuniversity.com/rules/axe/4.10/target-size
- https://github.com/dequelabs/axe-core
- https://github.com/dequelabs/axe-core/blob/develop/doc/API.md
- https://www.gatsbyjs.com/blog/2019-07-11-user-testing-accessible-client-routing/
- https://nextjs.org/docs/architecture/accessibility#route-announcements
- https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/
- https://playwright.dev/docs/accessibility-testing
- https://blog.usablenet.com/ada-web-lawsuit-trends-2026
- https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-order-requires-online-marketer-pay-1-million-deceptive-claims-its-ai-product-could-make-websites
- https://www.ftc.gov/news-events/news/press-releases/2025/04/ftc-approves-final-order-requiring-accessibe-pay-1-million
- https://www.levelaccess.com/compliance-overview/european-accessibility-act-eaa/
- https://www.traverssmith.com/knowledge/knowledge-container/a-new-milestone-for-accessibility-the-european-accessibility-act-now-applies/
- https://www.ada.gov/resources/2024-03-08-web-rule/

**Broken features**

- https://arxiv.org/abs/2505.03733
- https://proceedings.neurips.cc/paper_files/paper/2025/hash/6841eed8bb6a2ec49e49235c8115efee-Abstract-Datasets_and_Benchmarks_Track.html
- https://arxiv.org/html/2403.08937
- https://link.springer.com/article/10.1007/s10664-025-10614-4
- https://axonbuild.com/blog/what-goes-wrong-with-vibe-coded-apps
- https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report
- https://blog.openreplay.com/prevent-double-form-submissions/
- https://www.greatfrontend.com/react-interview-playbook/react-data-fetching
- https://supabase.com/docs/guides/auth/redirect-urls
- https://dev.to/arling/supabase-oauth-redirects-to-localhost-in-production-the-allow-list-rule-nobody-reads-3g1b
- https://github.com/supabase/supabase/issues/12941
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/sessions
- https://community.latenode.com/t/debugging-email-password-reset-functionality-in-supabase-lovable-integration/37537
- https://answers.netlify.com/t/support-guide-direct-links-to-my-single-page-app-spa-dont-work/126
- https://www.pewresearch.org/data-labs/2024/05/17/when-online-content-disappears/
- https://nextjs.org/docs/messages/react-hydration-error
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date
- https://vite.dev/guide/env-and-mode
- https://almanac.httparchive.org/en/2024/accessibility
- https://www.devclass.com/ai-ml/2025/02/20/ai-is-eroding-code-quality-states-new-in-depth-report/1626250
- https://arxiv.org/abs/2410.06992
- https://rockingtech.co.uk/blog/why-your-vibe-coded-app-keeps-breaking
- https://survey.stackoverflow.co/2025/ai
- https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- https://vercel.com/docs/skew-protection
- https://vercel.com/docs/functions/limitations
- https://playwright.dev/docs/browsers

**Non-technical blind spots**

- https://supabase.com/docs/guides/deployment/going-into-prod
- https://supabase.com/docs/guides/platform/backups
- https://opsily.com/blog/hardcoded-localhost-url-in-production-build
- https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content
- https://www.ignite.video/en/articles/basics/cookie-consent-studies
- https://www.ftc.gov/policy/advocacy-research/tech-at-ftc/2023/03/lurking-beneath-surface-hidden-impacts-pixel-tracking
- https://www.ftc.gov/news-events/news/press-releases/2023/02/ftc-enforcement-action-bar-goodrx-sharing-consumers-sensitive-health-info-advertising
- https://support.google.com/analytics/answer/6366371?hl=en
- https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/
- https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage
- https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- https://prerender.io/blog/how-to-fix-link-previews/
- https://www.searchviu.com/en/robots-txt-staging-environment/
- https://almanac.httparchive.org/en/2025/performance
- https://dmarcwise.io/blog/gmail-yahoo-new-requirements-2024
- https://developer.chrome.com/docs/devtools/console/understand-messages
- https://web.dev/baseline
- https://www.copyright.gov/newsnet/2025/1060.html

**Market and competition**

- https://cloud.google.com/resources/content/2025-dora-ai-assisted-software-development-report
- https://techcrunch.com/2026/06/09/lovable-says-it-has-hit-500m-in-annualized-revenue-with-1-million-new-projects-a-week/
- https://www.fastly.com/blog/senior-developers-ship-more-ai-code
- https://docs.lovable.dev/integrations/aikido
- https://bolt.new/blog/security-audit-on-publish
- https://docs.replit.com/replit-workspace/workspace-features/security-scanner
- https://vercel.com/blog/v0-vibe-coding-securely
- https://www.qawolf.com/
- https://momentic.ai/pricing
- https://www.testmuai.com/octomind-alternative/
- https://testrigor.com/
- https://www.meticulous.ai/
- https://checksum.ai/
- https://smartbear.com/news/news-releases/smartbear-acquires-reflect/
- https://playwright.dev/docs/test-agents
- https://github.com/browser-use/browser-use
- https://github.com/browserbase/stagehand
- https://github.com/antiwork/shortest
- https://www.zaproxy.org/blog/2024-09-24-zap-has-joined-forces-with-checkmarx/
