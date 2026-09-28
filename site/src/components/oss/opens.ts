/**
 * Where a link off the site opens, for the link primitives' `opens` prop (said to screen readers after the link text):
 * "GitHub" for a GitHub URL, nothing otherwise. Shared by the open-source page, the FAQ's answers and its "At a glance".
 */
export const opensOn = (href: string) => (href.startsWith("https://github.com/") ? "GitHub" : undefined);
