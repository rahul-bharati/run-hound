import { bugFormUrl } from "@/lib/nav";
import { cx } from "./class-names";
import { primitiveLabels } from "./labels";
import { TextLink } from "./links";

/** The bug form on GitHub with a page's path as the issue title, and nothing else (no run data, no query of the page). */
export function bugReportUrl(path: string): string {
  return `${bugFormUrl}&title=${encodeURIComponent(path)}`;
}

/**
 * "Something wrong or unclear on this page? Report it on GitHub." (DESIGN.md §2.5), at the end of docs and check pages,
 * instead of "Edit this page" until contributions open (decision 4). `path` is the page's registry path.
 */
export function ReportLine({ path, className }: { path: string; className?: string }) {
  return (
    <p className={cx("report-line", className)}>
      {primitiveLabels.reportQuestion} <TextLink href={bugReportUrl(path)}>{primitiveLabels.reportLink}</TextLink>.
    </p>
  );
}
