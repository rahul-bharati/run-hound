import type { Metadata } from "next";
import { ButtonLink } from "@/components/button-link";
import { Container, Eyebrow } from "@/components/layout";

export const metadata: Metadata = {
  title: "Page not found",
  description: "This page does not exist. Head back to the Run Hound home page or the docs.",
};

export default function NotFound() {
  return (
    <Container className="flex flex-1 flex-col items-center justify-center gap-6 py-24 text-center sm:py-32">
      <Eyebrow>404 · NOT FOUND</Eyebrow>
      <h1 className="max-w-3xl font-display text-5xl font-extrabold leading-[0.98] tracking-[-0.03em] sm:text-7xl">
        Dead link. <span className="text-amber">We checked.</span>
      </h1>
      <p className="max-w-xl text-lg leading-relaxed text-muted">
        The page you were looking for does not exist or has moved. The hound sniffed around and came back empty.
      </p>
      <div className="flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
        <ButtonLink href="/" className="w-full sm:w-auto">
          Back to home
        </ButtonLink>
        <ButtonLink href="/docs" variant="secondary" className="w-full sm:w-auto">
          Read the docs
        </ButtonLink>
      </div>
    </Container>
  );
}
