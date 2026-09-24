import type { Metadata } from "next";
import Link from "next/link";
import { LegalTitle, MailLink } from "@/components/legal/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How the Run Hound website and the Run Hound software handle personal data: hosting logs, Cloudflare, Google Analytics only with your consent, tester feedback, and software that runs on your machine.",
};

export default function PrivacyPage() {
  return (
    <>
      <LegalTitle
        title="Privacy policy"
        lede={
          <>
            This policy covers this website, the feedback you send us as a tester, and the {site.name} software. The
            short version: the site uses Google Analytics only if you accept it, the software runs on your machine and
            does not send us data about the apps you test, and anything you send us as feedback is used only to
            improve {site.name}.
          </>
        }
      />

      <p>
        {site.name} is in early development and is being tried by a small group of testers. This policy describes
        how the website and the current preview work. We will update this page before anything changes.
      </p>

      <h2 id="who-we-are">Who we are</h2>
      <p>
        {site.name} is run by <strong>Rahul Bharati</strong>, an individual based in <strong>Mumbai, India</strong>,
        who decides how personal data connected with {site.name} is used (the &ldquo;data controller&rdquo;, or
        &ldquo;data fiduciary&rdquo; under India&apos;s Digital Personal Data Protection Act, 2023). You can reach
        us about privacy at <MailLink address={site.contactEmail} />.
      </p>

      <h2 id="website">This website</h2>
      <p>
        This is a static website: every page is a pre-built file, and there is no account system, database or form.
        It does not collect anything you type.
      </p>

      <h3 id="hosting">Hosting and server logs</h3>
      <p>
        The site runs on a server we rent from <strong>Hostinger</strong> in its <strong>Mumbai, India</strong> data
        centre. When you open a page, the server may log standard request details: your IP address, the page
        requested, the time, the referring page and your browser&apos;s user agent. We use these logs only to deliver
        the site, keep it secure and fix problems, and we keep them no longer than needed for that, normally{" "}
        <strong>no more than 30 days</strong>.
      </p>

      <h3 id="cloudflare">Cloudflare</h3>
      <p>
        Traffic to the site passes through <strong>Cloudflare</strong>, which protects it from attacks and delivers it
        quickly. To do that, Cloudflare processes your IP address and request details, and it may set a short-lived
        security cookie (see <a href="#cookies">Cookies</a>). We also use <strong>Cloudflare Web Analytics</strong>{" "}
        to count page views. It sets no cookies and does not track you across sites. Cloudflare handles this data under
        its own privacy policy, and it may process it in data centres outside India.
      </p>

      <h3 id="google-analytics">Google Analytics, only with your consent</h3>
      <p>
        If you accept analytics in the banner, we load <strong>Google Analytics 4</strong> to understand which pages
        are read and how visitors find the site. It sets cookies in your browser and sends Google information such as
        the pages you view, how long you stay, your approximate location, and your device and browser type. Google
        Analytics 4 does not log or store IP addresses. We do not use it for advertising, we do not combine it with
        other data about you, and we keep the data for <strong>14 months</strong>. Google processes it under its own
        terms, including in the United States.
      </p>
      <p>
        If you reject analytics, or ignore the banner, Google Analytics is never loaded. You can change your choice at
        any time with <strong>Cookie settings</strong> at the bottom of every page; withdrawing consent stops Google
        Analytics and removes its cookies.
      </p>

      <h3 id="cookies">Cookies and similar storage</h3>
      <div className="overflow-x-auto" role="region" aria-label="Cookies used on this site" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Set by</th>
              <th scope="col">Purpose</th>
              <th scope="col">Lasts</th>
              <th scope="col">Consent</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>__cf_bm</code>
              </td>
              <td>Cloudflare</td>
              <td>Tells people from bots, to protect the site</td>
              <td>30 minutes</td>
              <td>Not needed (strictly necessary)</td>
            </tr>
            <tr>
              <td>
                <code>rh-analytics-consent</code>
              </td>
              <td>This site (stored in your browser, not a cookie)</td>
              <td>Remembers whether you accepted or rejected analytics</td>
              <td>12 months, then we ask again</td>
              <td>Not needed (records your choice)</td>
            </tr>
            <tr>
              <td>
                <code>_ga</code>
              </td>
              <td>Google Analytics</td>
              <td>Tells visits by the same browser apart</td>
              <td>2 years</td>
              <td>Only if you accept</td>
            </tr>
            <tr>
              <td>
                <code>_ga_&lt;ID&gt;</code>
              </td>
              <td>Google Analytics</td>
              <td>Keeps the state of your current visit</td>
              <td>2 years</td>
              <td>Only if you accept</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 id="external-links">Links to other sites</h3>
      <p>
        Some links go to other sites, such as our <a href={site.github}>GitHub repository</a>. Those sites have their
        own privacy policies, which apply once you leave this one.
      </p>

      <h2 id="testers">Feedback from testers</h2>
      <p>
        If you try {site.name} and send us feedback, by email or through GitHub issues, we receive what you choose to
        send: your name or GitHub username, your email address if you email us, your message, and any files you
        attach, such as a {site.name} report. We use this only to understand problems, improve {site.name} and reply
        to you. We don&apos;t add you to mailing lists or share your feedback with anyone else.
      </p>
      <ul>
        <li>
          <strong>Reports can contain your app&apos;s data.</strong> A report includes screenshots, recordings and
          request details from the app you tested. Before you send one, remove anything you don&apos;t want to share,
          such as real customer data or internal URLs. Test against development data where you can.
        </li>
        <li>
          <strong>GitHub issues are public.</strong> Anything you post in an issue can be read by anyone and is
          handled by GitHub under its own privacy policy. For anything sensitive, email us instead.
        </li>
        <li>
          <strong>Deletion.</strong> We keep feedback emails and attachments while {site.name} is in its preview and
          delete them when they are no longer needed, or sooner if you ask. We can delete issues or comments in our
          repository on request.
        </li>
      </ul>

      <h2 id="software">The {site.name} software</h2>
      <p>
        {site.name} runs on your own machine, for example as a Docker container you start yourself. It opens the app
        you point it at in a browser on that machine and writes its reports there.
      </p>
      <ul>
        <li>
          <strong>Your test data stays with you.</strong> {site.name} does not send us data about the app you test:
          no page content, screenshots, reports or findings. It has no telemetry.
        </li>
        <li>
          <strong>No AI model yet.</strong> The current preview makes every decision with fixed rules and sends
          nothing to any AI provider. Later versions may let you use a model you choose: a local one, where page
          content stays on your machine, or a cloud provider, which would receive page content and screenshots under
          its own terms. We will describe this here before it ships.
        </li>
        <li>
          <strong>Paid features, if they ever exist.</strong> The core stays open source. If paid features are added
          later, their license check would send only the license key and the software version.
        </li>
      </ul>
      <p>
        Because the software runs on your machine, you are responsible for the data it processes there, including
        any personal data inside the app you test.
      </p>

      <h2 id="your-rights">Your rights</h2>
      <p>
        Depending on where you live, laws such as India&apos;s Digital Personal Data Protection Act, 2023, the EU and
        UK GDPR, or the California Consumer Privacy Act may give you rights over your personal data, including the
        right to:
      </p>
      <ul>
        <li>know what personal data we hold about you and get a copy of it;</li>
        <li>have inaccurate data corrected or completed;</li>
        <li>have your data deleted;</li>
        <li>withdraw consent, for example to analytics, at any time;</li>
        <li>object to or restrict how we use it, and receive it in a portable format;</li>
        <li>have a complaint or grievance heard.</li>
      </ul>
      <p>
        We do not sell personal data or share it for targeted advertising. To use any of these rights, or to raise a
        grievance, email <MailLink address={site.contactEmail} />; we aim to reply within 30 days. If you are not
        satisfied, you can complain to your data protection authority, which in India is the Data Protection Board of
        India.
      </p>

      <h2 id="children">Children</h2>
      <p>
        This website and the software are made for developers and testers. They are not directed at children, and we
        do not knowingly collect children&apos;s personal data.
      </p>

      <h2 id="changes">Changes to this policy</h2>
      <p>
        We will update this page when our practices change and revise the &ldquo;Last updated&rdquo; date above. For
        how {site.name} may and may not be used, see the <Link href="/acceptable-use">Acceptable Use Policy</Link>.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        Questions about this policy: <MailLink address={site.contactEmail} />. Data controller:{" "}
        <strong>Rahul Bharati</strong>, <strong>Mumbai, India</strong>.
      </p>
    </>
  );
}
