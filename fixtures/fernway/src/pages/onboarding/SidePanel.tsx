import { CalendarRange, ChartNoAxesColumn, FolderKanban } from "lucide-react";
import { images } from "@/lib/images";
import { initials } from "@/lib/utils";
import { SLUG_PREFIX, type WorkspaceValues } from "./schema";
import { USE_CASES } from "./StepWorkspace";

const PERKS = [
  { icon: FolderKanban, title: "A sample project", text: "Tasks, files and a timeline to explore before you add your own." },
  { icon: CalendarRange, title: "Workload view", text: "See who is free next week before you promise a date." },
  { icon: ChartNoAxesColumn, title: "Client digests", text: "A weekly summary your clients can read in a minute." },
];

/** Right column from lg up: the illustration with a live preview of the workspace, and what comes with it. */
export function SidePanel({ preview }: { preview: WorkspaceValues }) {
  const name = preview.workspaceName.trim() || "Your studio";
  const slug = preview.slug || "your-studio";
  const useCase = USE_CASES.find((u) => u.value === preview.useCase);
  const art = images.onboarding;
  return (
    <div className="hidden lg:block">
      <div className="sticky top-6 flex flex-col gap-4">
        <div className="relative overflow-hidden rounded-3xl border bg-card shadow-soft">
          <img src={art.src} alt={art.alt} width={art.width} height={art.height} className="aspect-[4/3] w-full object-cover dark:brightness-[.85]" />
          <div aria-hidden="true" className="absolute inset-x-4 bottom-4 animate-slide-up rounded-2xl bg-card/92 p-4 shadow-xl ring-1 ring-border/60 backdrop-blur-md">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Preview</p>
            <div className="mt-2 flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br from-primary to-brand-via text-sm font-bold text-primary-foreground">
                {initials(name) || "YS"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{`${SLUG_PREFIX}${slug}`}</p>
              </div>
              {useCase && <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">{useCase.label}</span>}
            </div>
          </div>
        </div>
        <div className="rounded-2xl border bg-card/90 p-5 shadow-soft backdrop-blur-sm">
          <h2 className="text-sm font-semibold">What's waiting for you</h2>
          <ul className="mt-4 grid gap-4">
            {PERKS.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                  <p.icon className="size-4" />
                </span>
                <div className="grid gap-0.5 text-sm">
                  <p className="font-medium">{p.title}</p>
                  <p className="text-muted-foreground">{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
