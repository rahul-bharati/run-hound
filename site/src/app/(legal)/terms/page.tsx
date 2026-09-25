import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, LegalHeading, type LegalTocItem, MailLink } from "@/components/legal/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "Terms of use for the Run Hound website, and how the planned Apache-2.0 license will govern the Run Hound software.",
};

const toc: LegalTocItem[] = [
  { id: "agreement", label: "Agreement" },
  { id: "software-license", label: "The software and its license" },
  { id: "as-is", label: "Provided “as is”" },
  { id: "liability", label: "Limitation of liability" },
  { id: "your-responsibility", label: "Your responsibility" },
  { id: "acceptable-use", label: "Acceptable Use Policy" },
  { id: "website-use", label: "Using this website" },
  { id: "changes", label: "Changes" },
  { id: "governing-law", label: "Governing law" },
  { id: "contact", label: "Contact" },
];

export default function TermsPage() {
  return (
    <LegalDoc
      title="Terms of use"
      lede={
        <>
          These terms cover your use of this website. The {site.name} software itself is governed by its open-source
          license.
        </>
      }
      toc={toc}
    >
      <LegalHeading id="agreement">Agreement</LegalHeading>
      <p>
        This website is operated by <strong>RAHUL BHARATI</strong> (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By
        using it, you agree to these terms. If you do not agree, please do not use the site.
      </p>

      <LegalHeading id="software-license">The software and its license</LegalHeading>
      <p>
        {site.name} is available only as an invite-only tester preview ({site.release} {site.version}) and has not been publicly
        released. It is planned to be released under the{" "}
        <a href="https://www.apache.org/licenses/LICENSE-2.0">Apache License, Version 2.0</a>. Once released, the
        license, not these terms, governs your rights to use, copy, modify and distribute the code. If these terms and the license ever
        conflict about the code, the license wins. The source is on <a href={site.github}>GitHub</a>.
      </p>

      <LegalHeading id="as-is">Provided &ldquo;as is&rdquo;</LegalHeading>
      <p>
        The website and the software are provided <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong>
        , without warranties of any kind, express or implied, including warranties of merchantability, fitness for a
        particular purpose and non-infringement. The software&apos;s license contains its own disclaimer of warranty
        and limitation of liability, which apply to the code.
      </p>
      <p>
        {site.name} tests apps automatically, and later versions may use AI models to plan tests and explain
        results. It can miss problems and it can report problems that are not real. Its findings are not a guarantee that an app is correct, accessible or secure, and they are not a
        substitute for your own review or a professional audit.
      </p>

      <LegalHeading id="liability">Limitation of liability</LegalHeading>
      <p>
        To the fullest extent the law allows, we are not liable for any indirect, incidental, special, consequential
        or punitive damages, or for any loss of data, profits or business, arising from your use of the website or
        the software. Nothing in these terms limits liability that cannot be limited under the law of{" "}
        <strong>India</strong>.
      </p>

      <LegalHeading id="your-responsibility">Your responsibility</LegalHeading>
      <p>You are responsible for how you use {site.name}. In particular, you agree:</p>
      <ul>
        <li>to test only apps and sites you own or are explicitly authorized to test;</li>
        <li>to follow the laws that apply to you and to the systems you test;</li>
        <li>
          to review what the agent plans to do before you approve it, and to enable destructive actions only when you
          understand the consequences;
        </li>
        <li>
          to handle any data the software processes lawfully, including data sent to a model provider if you choose to
          use one.
        </li>
      </ul>

      <LegalHeading id="acceptable-use">Acceptable Use Policy</LegalHeading>
      <p>
        Our <Link href="/acceptable-use">Acceptable Use Policy</Link> is part of these terms. It explains what you may
        test, how {site.name} is designed to enforce that, and which uses are prohibited.
      </p>

      <LegalHeading id="website-use">Using this website</LegalHeading>
      <p>
        Please do not attempt to disrupt the website, access it in ways that put an unreasonable load on it, or use it
        for anything unlawful. If you find a security issue, please report it as described on our{" "}
        <Link href="/security">Security page</Link>.
      </p>

      <LegalHeading id="content" level={3}>Content and trademarks</LegalHeading>
      <p>
        Website text and images are provided for information only. The Apache-2.0 license covers the code; it does
        not grant rights to use the {site.name} name or logo. Screenshots and evidence on this site come from runs on
        Kennel, our deliberately broken demo app, not from real apps; anything else is labelled as a sample.
      </p>

      <LegalHeading id="links" level={3}>Links to other sites</LegalHeading>
      <p>We link to sites we do not control, such as GitHub. We are not responsible for their content or terms.</p>

      <LegalHeading id="changes">Changes</LegalHeading>
      <p>
        We may update these terms. When we do, we will change the &ldquo;Last updated&rdquo; date above. Continuing to
        use the website after a change means you accept the updated terms.
      </p>

      <LegalHeading id="governing-law">Governing law</LegalHeading>
      <p>
        These terms are governed by the laws of <strong>India</strong>, and disputes will be handled by the
        courts of <strong>India</strong>, unless the law where you live gives you the right to bring a claim
        elsewhere.
      </p>

      <LegalHeading id="contact">Contact</LegalHeading>
      <p>
        Questions about these terms: <MailLink address={site.contactEmail} />.
      </p>
    </LegalDoc>
  );
}
