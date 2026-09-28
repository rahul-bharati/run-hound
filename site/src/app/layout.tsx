import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { Consent } from "@/components/consent/consent";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { sharedMetadata, socialImage } from "@/lib/metadata";
import { site } from "@/lib/site";
import "./globals.css";
// The header, search and footer styles, after globals.css (in its components layer).
import "@/components/header/chrome.css";

// On a slow link the fonts arrive after the first paint, and swapping them in re-wraps the text and shifts what
// follows: the display font's big headings on phones, Geist's body text on the long legal pages on desktop.
// "optional" gives each font a short block period and otherwise keeps the size-adjusted fallback until the next
// full page load, which uses the cached font. Geist Mono only sets short labels and code, which don't re-wrap.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "optional",
});

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "optional",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Each page adds its canonical URL and og:url (lib/metadata.ts); none is set here, because every page would inherit
// it. The preview image (socialImage) is the same on every page.
export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    template: `%s · ${site.name}`,
    default: `${site.name}: ${site.tagline}`,
  },
  description: site.description,
  // No robots here: every page gets it through pageMetadata, and the 404 page keeps only the noindex Next.js adds.
  authors: sharedMetadata.authors,
  creator: sharedMetadata.creator,
  openGraph: {
    siteName: site.name,
    type: "website",
    locale: "en_US",
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    images: [socialImage],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a1014",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${geist.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-accent focus:px-4 focus:py-2 focus:font-semibold focus:text-accent-ink"
        >
          Skip to content
        </a>
        <SiteHeader />
        {/* The search index (scripts/pagefind.mjs) holds <main> only: never the header, the footer or the menu. */}
        <main id="main" className="flex flex-1 flex-col" data-pagefind-body="">
          {children}
        </main>
        <SiteFooter />
        <Consent />
      </body>
    </html>
  );
}
