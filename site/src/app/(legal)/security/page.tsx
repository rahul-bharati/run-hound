import type { Metadata } from "next";
import Link from "next/link";
import { LegalTitle, MailLink, ReviewNote } from "@/components/legal/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How to report a vulnerability in Run Hound or this website, what to include, what is in scope and how we respond.",
};

export default function SecurityPage() {
  return (
    <>
      <LegalTitle
        title="Security and vulnerability disclosure"
        lede={
          <>
            We want to hear about security problems in {site.name} and this website. This page explains how to report
            them and what you can expect from us.
          </>
        }
      />

      <h2 id="how-to-report">How to report</h2>
      <p>Report vulnerabilities privately, using either:</p>
      <ul>
        <li>
          email to <MailLink address={site.securityEmail} />; or
        </li>
        <li>
          GitHub private vulnerability reporting on the <a href={`${site.github}/security`}>{site.name} repository</a>{" "}
          (Security tab, &ldquo;Report a vulnerability&rdquo;).
        </li>
      </ul>
      <p>
        Please do not open public GitHub issues, pull requests or discussions for security problems, and do not share
        details publicly until we have released a fix or agreed on a disclosure date with you.
      </p>

      <h2 id="what-to-include">What to include</h2>
      <ul>
        <li>a description of the issue and its likely impact;</li>
        <li>the affected component and version, commit or page;</li>
        <li>steps to reproduce, or a minimal proof of concept;</li>
        <li>any logs or screenshots that help, with other people&apos;s data removed;</li>
        <li>how you would like to be credited, if at all.</li>
      </ul>

      <h2 id="response">What to expect</h2>
      <p>These are our targets, not guarantees:</p>
      <ul>
        <li>
          acknowledge your report within <strong>3 business days</strong>;
        </li>
        <li>
          give an initial assessment within <strong>10 business days</strong>;
        </li>
        <li>keep you updated while we work on a fix;</li>
        <li>credit you in the release notes or advisory, if you want to be credited.</li>
      </ul>
      <p>
        We aim to publish fixes and a security advisory within <strong>90 days</strong> of confirming an issue,
        depending on its severity and complexity.
      </p>

      <h2 id="scope">Scope</h2>
      <h3 id="in-scope">In scope</h3>
      <ul>
        <li>
          the {site.name} source code in the <a href={site.github}>official repository</a>;
        </li>
        <li>official {site.name} releases and container images, once published;</li>
        <li>
          the safeguards that limit what {site.name} may test, such as ownership verification and the opt-in for
          destructive actions;
        </li>
        <li>this website.</li>
      </ul>

      <h3 id="out-of-scope">Out of scope</h3>
      <ul>
        <li>apps and sites tested with {site.name}; report those to their owners;</li>
        <li>
          third-party services {site.name} works with, such as model providers, browsers or our hosting provider;
          report those to the vendor;
        </li>
        <li>forks and modified versions we do not maintain;</li>
        <li>denial of service, load testing, spam and social engineering of people;</li>
        <li>
          missing best-practice headers or configuration on this website without a demonstrated security
          impact;
        </li>
        <li>issues that need a compromised machine or physical access to the user&apos;s device.</li>
      </ul>

      <h2 id="safe-harbor">Good-faith research</h2>
      <ReviewNote>
        This section is a draft and will be reviewed by a lawyer before launch. It is not yet a binding commitment.
      </ReviewNote>
      <p>
        If you act in good faith and follow this policy, we will not pursue or support legal action against you for
        your research, and we will consider it authorized. Good faith means that you:
      </p>
      <ul>
        <li>test only your own installation of {site.name}, or this website within the limits above;</li>
        <li>avoid privacy violations, data destruction and service disruption;</li>
        <li>access no more data than needed to show the issue, and delete it afterwards;</li>
        <li>give us reasonable time to fix the issue before disclosing it;</li>
        <li>
          follow our <Link href="/acceptable-use">Acceptable Use Policy</Link> and the law.
        </li>
      </ul>
      <p>
        This does not authorize testing systems that belong to anyone else. If you are unsure whether something is
        allowed, ask us first at <MailLink address={site.securityEmail} />.
      </p>

      <h2 id="bug-bounty">Bug bounty</h2>
      <p>
        We do not run a bug bounty program at the moment, so we cannot offer payment for reports. We are grateful for
        every report and will credit you if you want.
      </p>
    </>
  );
}
