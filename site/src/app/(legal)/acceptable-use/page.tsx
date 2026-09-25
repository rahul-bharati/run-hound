import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, LegalHeading, type LegalTocItem, MailLink } from "@/components/legal/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Acceptable use",
  description:
    "Run Hound is for testing apps you own or are authorized to test. How it enforces that, and which uses are prohibited.",
};

const toc: LegalTocItem[] = [
  { id: "the-rule", label: "The rule" },
  { id: "enforcement", label: "How Run Hound enforces it" },
  { id: "prohibited", label: "Prohibited uses" },
  { id: "findings", label: "Handling findings responsibly" },
  { id: "reporting-misuse", label: "Reporting misuse" },
  { id: "changes", label: "Changes" },
];

export default function AcceptableUsePage() {
  return (
    <LegalDoc
      title="Acceptable use policy"
      lede={
        <>
          {site.name} is built to test your own apps. This policy sets out what you may point it at, how the software
          is designed to enforce that, and what is not allowed.
        </>
      }
      toc={toc}
    >
      <p>
        This policy is part of our <Link href="/terms">Terms of use</Link>. {site.name} is a public open-source preview
        ({site.release} {site.version}); the safeguards below describe how it is designed to work, and the ones marked
        planned arrive with later versions.
      </p>

      <LegalHeading id="the-rule">The rule: only test what you are allowed to test</LegalHeading>
      <p>
        Use {site.name} only on apps and sites that <strong>you own</strong>, or that you have{" "}
        <strong>explicit permission</strong> from the owner to test. If you are testing for a client or employer, get
        that permission in writing and stay within its scope. When in doubt, do not run the test.
      </p>

      <LegalHeading id="enforcement">How {site.name} enforces it</LegalHeading>
      <p>The software is designed so that the safe path is the default:</p>
      <ul>
        <li>
          <strong>Local only, for now.</strong> The current preview tests only <code>localhost</code>, loopback and
          private network addresses, plus host names you list yourself in <code>RUNHOUND_ALLOWED_HOSTS</code> (list
          only hosts you own). Public sites are refused, and the browser is stopped if a page navigates somewhere
          else.
        </li>
        <li>
          <strong>Ownership verification for anything else (planned).</strong> Before it will test any other
          domain, you will have to prove you control it, either with a DNS TXT record or with a one-time nonce placed in a{" "}
          <code>&lt;meta&gt;</code> tag in the site&apos;s HTML head. The test runs only where the nonce is found.
        </li>
        <li>
          <strong>You approve the plan.</strong> The web UI shows every check it plans for the page, and what each
          one may create, and waits for your approval before it runs. On the command line, only the recommended
          scenarios run unless you choose others with <code>--approve</code>, and <code>--plan-only</code> shows the
          plan without running anything.
        </li>
        <li>
          <strong>Destructive actions are opt-in.</strong> Actions with real consequences, such as real payments or
          deleting data, are off unless you explicitly turn them on.
        </li>
      </ul>
      <p>
        These safeguards reduce mistakes; they do not transfer responsibility. You remain responsible for making sure
        you are authorized to test a target.
      </p>

      <LegalHeading id="prohibited">Prohibited uses</LegalHeading>
      <p>You must not use {site.name}, or any modified version of it, to:</p>
      <ul>
        <li>test, scan or probe third-party apps, sites or systems without the owner&apos;s permission;</li>
        <li>cause a denial of service, or run load or stress tests against systems you do not own;</li>
        <li>attempt credential attacks, such as guessing, stuffing or spraying passwords, against any account;</li>
        <li>access, collect or exfiltrate other people&apos;s data;</li>
        <li>bypass, disable or fake the ownership verification, or help others do so;</li>
        <li>use findings to harm, extort or embarrass anyone, or to break into systems;</li>
        <li>break any law or regulation that applies to you or to the system being tested.</li>
      </ul>
      <p>
        The MIT license lets you modify the code. Removing safeguards in your own copy does not make a
        prohibited use acceptable, and you alone are responsible for what a modified version does.
      </p>

      <LegalHeading id="findings">Handling findings responsibly</LegalHeading>
      <p>
        If {site.name} surfaces a problem in a system you are authorized to test but do not own, report it to the
        owner through their agreed channel and keep the details confidential until it is fixed.
      </p>

      <LegalHeading id="reporting-misuse">Reporting misuse</LegalHeading>
      <p>
        If you believe someone is using {site.name} against a system without permission, email{" "}
        <MailLink address={site.contactEmail} /> with what you observed and when. For a vulnerability in {site.name}{" "}
        itself, see our <Link href="/security">Security policy</Link>.
      </p>

      <LegalHeading id="changes">Changes</LegalHeading>
      <p>
        We may update this policy as {site.name} gains new capabilities, such as testing live sites. We will change the
        &ldquo;Last updated&rdquo; date above when we do.
      </p>
    </LegalDoc>
  );
}
