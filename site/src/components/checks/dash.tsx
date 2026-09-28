import styles from "./checks.module.css";

/**
 * A plain dash marking an item of a list of what isn't tested or can't be seen (a check page's Limits, the hub's "What
 * a browser can't see"). The dim tick (§2.5) marks the other lists; beside these items it would read as passed or
 * covered. Decorative: the text beside it carries the meaning.
 */
export function Dash() {
  return <span className={styles.dash} aria-hidden="true" />;
}
