import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, LegalHeading, type LegalTocItem, MailLink, ReviewNote } from "@/components/legal/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How to report a vulnerability in Run Hound or this website, what to include, what is in scope and how we respond.",
};

const toc: LegalTocItem[] = [
  { id: "how-to-report", label: "How to report" },
  { id: "what-to-include", label: "What to include" },
  { id: "response", label: "What to expect" },
  { id: "scope", label: "Scope" },
  { id: "safe-harbor", label: "Good-faith research" },
  { id: "bug-bounty", label: "Bug bounty" },
];

export default function SecurityPage() {
  return (
    <LegalDoc
      title="Security and vulnerability disclosure"
      lede={
        <>
          We want to hear about security problems in {site.name} and this website. This page explains how to report
          them and what you can expect from us.
        </>
      }
      toc={toc}
    >
      <LegalHeading id="how-to-report">How to report</LegalHeading>
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

      <LegalHeading id="what-to-include">What to include</LegalHeading>
      <ul>
        <li>a description of the issue and its likely impact;</li>
        <li>the affected component and version, commit or page;</li>
        <li>steps to reproduce, or a minimal proof of concept;</li>
        <li>any logs or screenshots that help, with other people&apos;s data removed;</li>
        <li>how you would like to be credited, if at all.</li>
      </ul>

      <LegalHeading id="response">What to expect</LegalHeading>
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

      <LegalHeading id="scope">Scope</LegalHeading>
      <LegalHeading id="in-scope" level={3}>In scope</LegalHeading>
      <ul>
        <li>
          the {site.name} source code in the <a href={site.github}>official repository</a>;
        </li>
        <li>official {site.name} releases and container images, once published;</li>
        <li>
          the safeguards that limit what {site.name} may test, such as the local-only target check, pinning the
          browser to the approved address and the opt-in for destructive actions;
        </li>
        <li>this website.</li>
      </ul>

      <LegalHeading id="out-of-scope" level={3}>Out of scope</LegalHeading>
      <ul>
        <li>apps and sites tested with {site.name}; report those to their owners;</li>
        <li>
          third-party services {site.name} works with, such as model providers, browsers or our hosting provider;
          report those to the vendor;
        </li>
        <li>
          the bugs planted on purpose in Kennel, the deliberately broken demo app that ships with {site.name};
        </li>
        <li>forks and modified versions we do not maintain;</li>
        <li>denial of service, load testing, spam and social engineering of people;</li>
        <li>
          missing best-practice headers or configuration on this website without a demonstrated security
          impact;
        </li>
        <li>issues that need a compromised machine or physical access to the user&apos;s device.</li>
      </ul>

      <LegalHeading id="safe-harbor">Good-faith research</LegalHeading>
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

      <LegalHeading id="bug-bounty">Bug bounty</LegalHeading>
      <p>
        We do not run a bug bounty program at the moment, so we cannot offer payment for reports. We are grateful for
        every report and will credit you if you want.
      </p>
    </LegalDoc>
  );
}
