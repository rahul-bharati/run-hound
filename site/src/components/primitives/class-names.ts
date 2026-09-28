/** Class names joined with single spaces, leaving out the ones that are false or empty. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** Whether an href leaves the site (an absolute http(s) URL): a plain <a>, not next/link. */
export function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}
