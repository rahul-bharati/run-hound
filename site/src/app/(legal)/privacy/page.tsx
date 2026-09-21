import type { Metadata } from "next";
import Link from "next/link";
import { LegalTitle, MailLink } from "@/components/legal/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How the Run Hound website and the Run Hound software handle personal data. The site sets no cookies and runs no analytics; the software runs on your machine.",
};

export default function PrivacyPage() {
  return (
    <>
      <LegalTitle
        title="Privacy policy"
        lede={
          <>
            This policy covers two things: this website, and the {site.name} software. The short version: the
            website collects nothing beyond standard hosting logs, and the software runs on your machine and does not
            send us data about the apps you test.
          </>
        }
      />

      <p>
        {site.name} is in early development. Nothing has been released yet, and this policy describes how the
        software is designed to work. We will update this page before any release if that changes.
      </p>

      <h2 id="who-we-are">Who we are</h2>
      <p>
        The data controller for this website is <strong>[LEGAL ENTITY NAME]</strong>. You can reach us about
        privacy at <MailLink address={site.contactEmail} />.
      </p>

      <h2 id="website">This website</h2>
      <p>This is a static website. Every page is a pre-built file; there is no account system and no database.</p>
      <ul>
        <li>
          <strong>No cookies.</strong> The site does not currently set any cookies.
        </li>
        <li>
          <strong>No analytics or tracking.</strong> We do not currently use analytics, advertising or tracking
          scripts.
        </li>
        <li>
          <strong>No forms.</strong> The site has no sign-up, contact or newsletter forms, so it does not collect
          anything you type.
        </li>
      </ul>

      <h3 id="server-logs">Server logs</h3>
      <p>
        The site is hosted by <strong>[HOSTING PROVIDER]</strong>. Like most hosts, it may keep standard server logs
        when you visit a page, such as your IP address, the page requested, the time, and your browser&apos;s user
        agent. These logs are used to deliver the site, keep it secure and diagnose problems. They are handled under
        the hosting provider&apos;s terms and kept for <strong>[RETENTION PERIOD]</strong>.
      </p>

      <h3 id="external-links">Links to other sites</h3>
      <p>
        Some links go to other sites, such as our <a href={site.github}>GitHub repository</a>. Those sites have their
        own privacy policies, which apply once you leave this one.
      </p>

      <p>
        If we ever add cookies, analytics or forms, we will update this policy first and, where the law requires it,
        ask for your consent.
      </p>

      <h2 id="software">The {site.name} software</h2>
      <p>
        {site.name} is designed to run on your own machine, for example as a Docker container you start yourself.
        It opens the app you point it at in a real browser and records what it finds.
      </p>
      <ul>
        <li>
          <strong>Your test data stays with you.</strong> {site.name} does not send us data about the app you test:
          no page content, screenshots, reports or findings.
        </li>
        <li>
          <strong>Your model provider, your choice.</strong> {site.name} uses an AI model that you configure. With a
          local model, page content stays on your machine. If you configure a cloud model provider, page content and
          screenshots from the app under test are sent to that provider, under that provider&apos;s terms and privacy
          policy. Choose a provider whose terms suit the data in your app.
        </li>
        <li>
          <strong>Paid features, if they ever exist.</strong> The core is planned to stay open source. If paid
          features are introduced later, their license check would send only the license key and the software
          version. We would document this here before it ships.
        </li>
      </ul>
      <p>
        Because the software runs on your machine, you are responsible for the data it processes there, including
        any personal data inside the app you test.
      </p>

      <h2 id="your-rights">Your rights</h2>
      <p>
        Depending on where you live, laws such as the EU and UK GDPR or the California Consumer Privacy Act (CCPA)
        may give you rights over your personal data. These can include the right to:
      </p>
      <ul>
        <li>know what personal data we hold about you and get a copy of it;</li>
        <li>have inaccurate data corrected;</li>
        <li>have your data deleted;</li>
        <li>object to or restrict how we use it;</li>
        <li>receive your data in a portable format;</li>
        <li>not be treated differently for using these rights.</li>
      </ul>
      <p>
        We do not sell personal data or share it for targeted advertising. In practice, the only personal data
        connected with this website is in the hosting provider&apos;s server logs. To use any of these rights, email{" "}
        <MailLink address={site.contactEmail} />. You also have the right to complain to your local data protection
        authority.
      </p>

      <h2 id="children">Children</h2>
      <p>
        This website and the software are aimed at developers and testers. They are not directed at children, and we
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
        <strong>[LEGAL ENTITY NAME]</strong>, <strong>[POSTAL ADDRESS]</strong>.
      </p>
    </>
  );
}
