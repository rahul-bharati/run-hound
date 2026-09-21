import type { Metadata } from "next";
import Link from "next/link";
import { LegalTitle, MailLink } from "@/components/legal/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Acceptable use",
  description:
    "Run Hound is for testing apps you own or are authorized to test. How it enforces that, and which uses are prohibited.",
};

export default function AcceptableUsePage() {
  return (
    <>
      <LegalTitle
        title="Acceptable use policy"
        lede={
          <>
            {site.name} is built to test your own apps. This policy sets out what you may point it at, how the software
            is designed to enforce that, and what is not allowed.
          </>
        }
      />

      <p>
        This policy is part of our <Link href="/terms">Terms of use</Link>. {site.name} is in early development; the
        safeguards below describe how it is designed to work, and some of them arrive with later versions.
      </p>

      <h2 id="the-rule">The rule: only test what you are allowed to test</h2>
      <p>
        Use {site.name} only on apps and sites that <strong>you own</strong>, or that you have{" "}
        <strong>explicit permission</strong> from the owner to test. If you are testing for a client or employer, get
        that permission in writing and stay within its scope. When in doubt, do not run the test.
      </p>

      <h2 id="enforcement">How {site.name} enforces it</h2>
      <p>The software is designed so that the safe path is the default:</p>
      <ul>
        <li>
          <strong>Local by default.</strong> {site.name} tests localhost and private network addresses out of the box.
          The first version tests localhost only.
        </li>
        <li>
          <strong>Ownership verification for anything else.</strong> Before it will test any other domain, you must
          prove you control it, either with a DNS TXT record or with a one-time nonce placed in a{" "}
          <code>&lt;meta&gt;</code> tag in the site&apos;s HTML head. The test runs only where the nonce is found.
        </li>
        <li>
          <strong>You approve the plan.</strong> The agent proposes what it will test and waits for your approval
          before it runs.
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

      <h2 id="prohibited">Prohibited uses</h2>
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
        The Apache-2.0 license lets you modify the code. Removing safeguards in your own copy does not make a
        prohibited use acceptable, and you alone are responsible for what a modified version does.
      </p>

      <h2 id="findings">Handling findings responsibly</h2>
      <p>
        If {site.name} surfaces a problem in a system you are authorized to test but do not own, report it to the
        owner through their agreed channel and keep the details confidential until it is fixed.
      </p>

      <h2 id="reporting-misuse">Reporting misuse</h2>
      <p>
        If you believe someone is using {site.name} against a system without permission, email{" "}
        <MailLink address={site.contactEmail} /> with what you observed and when. For a vulnerability in {site.name}{" "}
        itself, see our <Link href="/security">Security policy</Link>.
      </p>

      <h2 id="changes">Changes</h2>
      <p>
        We may update this policy as {site.name} gains new capabilities, such as testing live sites. We will change the
        &ldquo;Last updated&rdquo; date above when we do.
      </p>
    </>
  );
}
