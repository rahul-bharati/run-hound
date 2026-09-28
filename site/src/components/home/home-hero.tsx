import { Fragment } from "react";
import { ButtonLink } from "@/components/primitives/button-link";
import { Command } from "@/components/primitives/command";
import { FactStrip } from "@/components/primitives/fact-strip";
import { Container } from "@/components/primitives/layout";
import { Pill } from "@/components/primitives/pill";
import { home } from "@/content/home";
import { ui } from "@/content/ui";
import { HeroRunFigure } from "./hero-run-figure";

/**
 * Block 0, the hero (DESIGN.md §3.1): the pill, the h1, the subhead with "free" and "your machine", the two buttons,
 * the command with Copy and its hint, the proof strip, then the run window. Nothing in the text column is ever held or
 * animated: the h1 is the LCP.
 *
 * One DOM for every width, in reading order: text, proof strip, figure. From 1024 px the grid puts the figure beside the
 * text (1 : 1.12) and the proof strip on its own row below both; below, the strip comes before the window (V3). The h1's
 * phrases are nowrap from 1024 px, so it reads "Find the bugs / your AI forgot / to test." there; its key words are an
 * exempt accent use (§2.3).
 */
export function HomeHero() {
  const hero = home.hero;
  const last = hero.h1.length - 1;
  return (
    <div className="hm-hero">
      <Container className="hm-hero-grid">
        <div className="hm-hero-text">
          <Pill href={hero.pill.href} className="hm-pill">
            {hero.pill.label}
          </Pill>
          <h1 className="hm-h1">
            {hero.h1.map((phrase, i) => (
              <Fragment key={phrase}>
                {i === last ? (
                  <span className="hm-phrase hm-key" data-accent-exempt="">
                    {phrase}
                  </span>
                ) : (
                  <span className="hm-phrase">{phrase}</span>
                )}
                {i < last ? " " : null}
              </Fragment>
            ))}
          </h1>
          <p className="hm-sub">{hero.subhead}</p>
          <div className="hm-actions">
            <ButtonLink href={hero.primary.href}>{hero.primary.label}</ButtonLink>
            <ButtonLink href={hero.secondary.href} variant="secondary" icon="github" shortLabel={hero.secondary.short}>
              {hero.secondary.label}
            </ButtonLink>
          </div>
          <Command
            command={hero.command}
            next={ui.afterCopy}
            className="hm-command"
            hint={
              <>
                {hero.hint.text}{" "}
                <a href={hero.hint.link.href} className="text-link">
                  {hero.hint.link.label}
                </a>
              </>
            }
          />
        </div>
        <FactStrip items={hero.proof} className="hm-strip" />
        <HeroRunFigure />
      </Container>
    </div>
  );
}
