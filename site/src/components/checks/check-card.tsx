import { Card } from "@/components/primitives/card";
import { ArrowLink } from "@/components/primitives/links";
import { Tag } from "@/components/primitives/tag";
import type { Check } from "@/content/checks/data";
import styles from "./checks.module.css";

/** Whether a catalog entry runs in the current release: every V0 entry, and later stages' entries marked shipped. */
export function isShipped(check: Check) {
  return check.stage === "V0" || check.shipped === true;
}

/**
 * A built-in check's card on the hub (DESIGN.md §3.7): its name (h3), what passing means in plain words, the id in mono,
 * the typical severity, "Signed in" and "Added in <release>" where they apply, and "How it's tested →" to its page.
 * The card keeps `id="<check id>"`, so /checks/#double-submit (reports before 0.6.0, the ItemList before a page exists)
 * still lands on it. A check without a page yet gets no link: nothing on the card points at itself.
 */
export function CheckCard({
  id,
  name,
  plain,
  severity,
  tags,
  link,
}: {
  id: string;
  name: string;
  plain: string;
  /** "Typical severity: high"; left out when nothing says. */
  severity?: string;
  tags: readonly string[];
  link?: { href: string; label: string };
}) {
  return (
    <Card as="li" id={id} interactive={link !== undefined} className={styles.checkCard}>
      <h3 className={styles.cardTitle}>{name}</h3>
      <p className={styles.small}>{plain}</p>
      <p className={styles.cardMeta}>
        <code className={styles.cardId}>{id}</code>
        {severity ? <span className={styles.cardSeverity}>{severity}</span> : null}
        {tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </p>
      {link ? (
        <p className={styles.cardLink}>
          <ArrowLink href={link.href} prefetch="intent">
            {link.label}
          </ArrowLink>
        </p>
      ) : null}
    </Card>
  );
}
