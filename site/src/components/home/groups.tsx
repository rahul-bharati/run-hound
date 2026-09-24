import { Check } from "lucide-react";
import { Icon, groupIcons } from "@/components/icon";
import { checkGroups } from "./data";

/** V0's checks in the three groups the plan, the live view and the report use. */
export function Groups() {
  return (
    <ul className="grid gap-5 lg:grid-cols-3">
      {checkGroups.map((group) => (
        <li key={group.id} className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-6 sm:p-7">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="flex items-center gap-3 font-display text-2xl font-bold tracking-tight">
              <Icon icon={groupIcons[group.id]} size={24} className="text-accent" />
              {group.label}
            </h3>
            <span className="font-display text-3xl font-extrabold tracking-tight text-accent">
              {group.checks.length}
              <span className="sr-only"> checks</span>
            </span>
          </div>
          <p className="leading-relaxed text-muted">{group.intro}</p>
          <ul className="flex flex-col border-t border-line-soft">
            {group.checks.map((check) => (
              <li key={check} className="flex gap-3 border-b border-line-soft py-3 text-[15px] leading-snug last:border-b-0">
                <Icon icon={Check} size={16} className="mt-0.5 text-accent" />
                {check}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
