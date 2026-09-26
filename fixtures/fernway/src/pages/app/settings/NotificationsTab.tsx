import { AtSign, BellRing, CalendarClock, Megaphone, Newspaper, RotateCcw, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { apiGet, apiPatch, isApiError, type NotificationSettings } from "@/lib/api";
import { useSessionUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { NOTIFICATION_SETTINGS, type NotificationKey } from "../constants";
import { useLoad } from "../data";

const ICONS: Record<NotificationKey, LucideIcon> = {
  productUpdates: Megaphone,
  weeklyDigest: Newspaper,
  mentions: AtSign,
  taskReminders: CalendarClock,
};

const loadSettings = (signal: AbortSignal) => apiGet<NotificationSettings>("/api/notifications", { signal });

/**
 * The Notifications tab: 4 Switches that save on toggle (PATCH /api/notifications { <key>: boolean }) with a toast.
 * A failed save puts the switch back and says so inline (role="alert") and in a toast.
 */
export function NotificationsTab() {
  const user = useSessionUser();
  const { state, reload, setData } = useLoad(loadSettings);
  const saving = useRef(new Set<NotificationKey>());
  const [busy, setBusy] = useState<ReadonlySet<NotificationKey>>(new Set());
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Changes save as soon as you flip a switch.");

  const toggle = async (key: NotificationKey, label: string, on: boolean) => {
    if (saving.current.has(key)) return;
    saving.current.add(key);
    setBusy(new Set(saving.current));
    setError("");
    setData((s) => ({ ...s, [key]: on }));
    try {
      const saved = await apiPatch<NotificationSettings>("/api/notifications", { [key]: on });
      setData(() => saved);
      const text = `${label} turned ${on ? "on" : "off"}`;
      setStatus(`${text}. Saved.`);
      toast.success(text);
    } catch (err) {
      setData((s) => ({ ...s, [key]: !on }));
      const message = isApiError(err) ? err.message : "Something went wrong on our side. Please try again.";
      setError(`${label} was not saved. ${message}`);
      setStatus("");
      toast.error(`${label} not saved`, { description: message });
    } finally {
      saving.current.delete(key);
      setBusy(new Set(saving.current));
    }
  };

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2 text-lg">
          <BellRing aria-hidden="true" className="size-5 text-primary" />
          Email notifications
        </CardTitle>
        <CardDescription>
          What Fernway sends to <span className="font-medium text-foreground">{user.email}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        <p role="status" className="text-sm text-muted-foreground">
          {state.status === "ready" ? status : ""}
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Setting not saved</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {state.status === "loading" && (
          <div aria-hidden="true" className="grid gap-3">
            {NOTIFICATION_SETTINGS.map((s) => (
              <Skeleton key={s.key} className="h-20 rounded-xl" />
            ))}
          </div>
        )}
        {state.status === "error" && (
          <Alert variant="destructive">
            <AlertTitle>We couldn't load your notification settings</AlertTitle>
            <AlertDescription>{state.error}</AlertDescription>
            <Button type="button" variant="outline" size="sm" className="mt-2 w-fit" onClick={reload}>
              <RotateCcw aria-hidden="true" />
              Try again
            </Button>
          </Alert>
        )}
        {state.status === "ready" && (
          <ul className="grid grid-cols-1 divide-y rounded-2xl border bg-card">
            {NOTIFICATION_SETTINGS.map((s) => {
              const Icon = ICONS[s.key];
              const id = `notify-${s.key}`;
              const on = state.data[s.key] === true;
              const pending = busy.has(s.key);
              return (
                <li key={s.key} className="flex items-center gap-4 p-4">
                  <span aria-hidden="true" className={cn("grid size-10 shrink-0 place-items-center rounded-xl transition-colors", on ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>
                    <Icon className="size-5" />
                  </span>
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <Label htmlFor={id} className="cursor-pointer">
                      {s.label}
                    </Label>
                    <p id={`${id}-description`} className="text-sm text-muted-foreground">
                      {s.description}
                    </p>
                  </div>
                  <Switch
                    id={id}
                    checked={on}
                    aria-describedby={`${id}-description`}
                    aria-busy={pending || undefined}
                    onCheckedChange={(checked) => void toggle(s.key, s.label, checked)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
