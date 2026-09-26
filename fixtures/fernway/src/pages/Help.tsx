import { Clock, Headset, Keyboard, MessageCircleQuestionMark } from "lucide-react";
import { Fragment } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSessionUser } from "@/lib/session";
import { useDocumentTitle } from "@/lib/utils";

interface Shortcut {
  action: string;
  /** Alternatives ("or"), each a key combination ("+"). */
  keys: string[][];
  note?: string;
}

/** What the keyboard does in Fernway: the shell's own ⌘K / Ctrl+K, and what the Radix widgets do on their own. */
const SHORTCUTS: Shortcut[] = [
  { action: "Open search and commands", keys: [["Ctrl", "K"]], note: "⌘ K on a Mac" },
  { action: "Close a dialog, menu or popover", keys: [["Esc"]] },
  { action: "Move to the next or previous control", keys: [["Tab"], ["Shift", "Tab"]] },
  { action: "Move between tabs, menu items and options", keys: [["Arrow keys"]] },
  { action: "Turn a switch or checkbox on or off", keys: [["Space"]] },
  { action: "Choose the highlighted item or send a form", keys: [["Enter"]] },
];

const FAQ = [
  {
    q: "How do I add a project?",
    a: "Press New project on the dashboard, or search for it with Ctrl K. Fill in the sheet and choose Create project: it shows up in the Projects table right away.",
  },
  {
    q: "How do I archive a project?",
    a: "Open the project's actions menu in the Projects table and choose Archive. Fernway asks first, because an archived project leaves the list for good.",
  },
  {
    q: "Where do I change my notifications?",
    a: "In Settings, on the Notifications tab. Each switch saves as soon as you flip it, so there is nothing else to press.",
  },
  {
    q: "Who can see my workspace?",
    a: "Only you and the people in it. Every workspace keeps its own projects, tasks and members, and nobody outside it can open them.",
  },
] as const;

const kbd =
  "inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 font-sans text-xs font-medium text-foreground shadow-xs";

function Keys({ keys }: { keys: string[][] }) {
  return (
    <>
      {keys.map((combo, i) => (
        <Fragment key={combo.join("+")}>
          {i > 0 && <span className="text-xs text-muted-foreground">or</span>}
          <span className="inline-flex items-center gap-1">
            {combo.map((key, j) => (
              <Fragment key={key}>
                {j > 0 && (
                  <span aria-hidden="true" className="text-xs text-muted-foreground">
                    +
                  </span>
                )}
                <kbd className={kbd}>{key}</kbd>
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * /app/help (CONTRACT.md "/app/help Help & shortcuts"): the keyboard shortcuts, a short FAQ and how to contact support.
 * Static content in the app shell (it asks the server only who is signed in); no form and no mailto link. V05 makes a
 * direct load of it answer 404, while the sidebar's Help link still renders it.
 */
export default function Help() {
  useDocumentTitle("Help & shortcuts");
  const user = useSessionUser();

  return (
    <AppShell>
      <div className="flex flex-col gap-6 lg:gap-8">
        <div>
          <p className="text-sm font-medium text-primary">{user.workspace}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Help &amp; shortcuts</h1>
          <p className="mt-2 text-muted-foreground">Work faster from the keyboard, find quick answers, or ask our team.</p>
        </div>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
          <section aria-labelledby="help-shortcuts" className="min-w-0 motion-safe:animate-slide-up lg:col-span-3">
            <Card className="gap-4">
              <CardHeader>
                <CardTitle as="h2" id="help-shortcuts" className="flex items-center gap-2 text-lg">
                  <Keyboard aria-hidden="true" className="size-5 text-primary" />
                  Keyboard shortcuts
                </CardTitle>
                <CardDescription>They work on every page of the app.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="divide-y divide-border">
                  {SHORTCUTS.map((s) => (
                    <div key={s.action} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                      <dt className="text-sm font-medium">{s.action}</dt>
                      <dd className="flex flex-wrap items-center gap-1.5">
                        <Keys keys={s.keys} />
                        {s.note && <span className="text-xs text-muted-foreground">({s.note})</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="help-support" className="min-w-0 motion-safe:animate-slide-up lg:col-span-2" style={{ animationDelay: "60ms" }}>
            <Card className="relative gap-4 overflow-hidden">
              <div aria-hidden="true" className="pointer-events-none absolute -top-20 -right-16 size-52 rounded-full bg-linear-to-br from-primary/25 via-brand-via/20 to-brand-to/20 blur-3xl" />
              <CardHeader>
                <CardTitle as="h2" id="help-support" className="flex items-center gap-2 text-lg">
                  <Headset aria-hidden="true" className="size-5 text-primary" />
                  Contact support
                </CardTitle>
                <CardDescription>Still stuck? A person on our team will help.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm leading-6">
                <p>
                  Write to <span className="font-semibold break-all">support@fernway.test</span> from the address you sign in
                  with, and mention your workspace, <span className="font-semibold">{user.workspace}</span>, so we can find it
                  quickly.
                </p>
                <p className="flex items-start gap-2 rounded-xl border bg-card/70 p-3 text-muted-foreground">
                  <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                  We answer within one business day, Monday to Friday.
                </p>
              </CardContent>
            </Card>
          </section>
        </div>

        <section aria-labelledby="help-faq" className="motion-safe:animate-slide-up" style={{ animationDelay: "120ms" }}>
          <Card className="gap-4">
            <CardHeader>
              <CardTitle as="h2" id="help-faq" className="flex items-center gap-2 text-lg">
                <MessageCircleQuestionMark aria-hidden="true" className="size-5 text-primary" />
                Frequently asked questions
              </CardTitle>
              <CardDescription>The questions studios ask us most.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
                {FAQ.map((item) => (
                  <div key={item.q}>
                    <h3 className="font-semibold">{item.q}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{item.a}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
