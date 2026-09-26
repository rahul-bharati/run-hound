import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, Clock, Mail, RotateCcw } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useForm, useWatch, type Control } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormErrorSummary, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPut, isApiError, profilePath, type Profile } from "@/lib/api";
import { useBug } from "@/lib/bugs";
import { images, type ImageAsset } from "@/lib/images";
import { useSessionUser } from "@/lib/session";
import { cn, initials } from "@/lib/utils";
import { LIMITS, TIME_ZONE_IDS, TIME_ZONE_OPTIONS } from "../constants";
import { useLoad } from "../data";

const schema = z.object({
  displayName: z.string().trim().min(1, "Enter your display name.").max(LIMITS.displayName, `Use ${LIMITS.displayName} characters or fewer.`),
  email: z.string().trim().min(1, "Enter your email address.").pipe(z.email("Enter an email address like name@example.com.")),
  bio: z.string().max(LIMITS.bio, `Keep your bio to ${LIMITS.bio} characters or fewer.`),
  timeZone: z.enum(TIME_ZONE_IDS, { error: "Choose a time zone from the list." }),
});
type Values = z.input<typeof schema>;
const FIELDS = ["displayName", "email", "bio", "timeZone"] as const;

const toValues = (p: Profile): Values => ({
  displayName: p.displayName,
  email: p.email,
  bio: p.bio,
  timeZone: (TIME_ZONE_IDS as readonly string[]).includes(p.timeZone) ? (p.timeZone as Values["timeZone"]) : "UTC",
});

function localTime(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date());
  } catch {
    return "";
  }
}

const place = (timeZone: string) => {
  const label = TIME_ZONE_OPTIONS.find((t) => t.value === timeZone)?.label ?? timeZone;
  return label.match(/\(([^)]+)\)/)?.[1] ?? label;
};

/** The profile's photo, or null when it has none (the page shows initials). */
const photoOf = (profile: Profile): ImageAsset | null => (typeof profile.avatar === "number" ? (images.avatars[profile.avatar] ?? null) : null);

/**
 * The Profile tab: loads the signed-in user's profile (GET /api/users/<me.id>/profile, the id from GET /api/me), then
 * shows the Profile form next to a live preview.
 */
export function ProfileTab() {
  const user = useSessionUser();
  const { state, reload, setData } = useLoad((signal) => apiGet<Profile>(profilePath(user.id), { signal }));
  if (state.status === "loading") {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <p role="status" className="sr-only">
          Loading your profile…
        </p>
        <Skeleton className="h-[34rem] rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>We couldn't load your profile</AlertTitle>
        <AlertDescription>{state.error}</AlertDescription>
        <Button type="button" variant="outline" size="sm" className="mt-2 w-fit" onClick={reload}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      </Alert>
    );
  }
  return <ProfileForm userId={user.id} profile={state.data} onSaved={(p) => setData(() => p)} />;
}

/**
 * The Profile form (CONTRACT.md): Display name, Email, Bio (160 characters, live counter), Time zone; "Save changes"
 * sends PUT /api/users/<id>/profile with those 4 fields only. W04: Bio is dropped from the request, yet the form still
 * shows it as saved.
 */
function ProfileForm({ userId, profile, onSaved }: { userId: string; profile: Profile; onSaved: (p: Profile) => void }) {
  const w04 = useBug("W04");
  const titleId = useId();
  const inFlight = useRef(false);
  const [saveError, setSaveError] = useState("");
  const [status, setStatus] = useState("");
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(profile) });
  const photo = photoOf(profile);

  const onSubmit = async (values: Values) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaveError("");
    setStatus("");
    const body: Partial<Values> = { displayName: values.displayName.trim(), email: values.email.trim(), bio: values.bio, timeZone: values.timeZone };
    // W04: the bio never reaches the server.
    if (w04) delete body.bio;
    try {
      const saved = await apiPut<Profile>(profilePath(userId), body);
      onSaved(saved);
      form.reset(w04 ? { ...toValues(saved), bio: values.bio } : toValues(saved));
      setStatus("Profile saved. Your changes are live across the workspace.");
      toast.success("Profile saved", { description: "Your changes are live across the workspace." });
    } catch (err) {
      let first = true;
      if (isApiError(err)) {
        for (const [field, message] of Object.entries(err.errors)) {
          if ((FIELDS as readonly string[]).includes(field)) {
            form.setError(field as (typeof FIELDS)[number], { type: "server", message }, { shouldFocus: first });
            first = false;
          }
        }
      }
      const message = isApiError(err) ? err.message : "Something went wrong on our side. Please try again.";
      setSaveError(message);
      toast.error("Profile not saved", { description: message });
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle as="h2" id={titleId} className="text-lg">
            Profile
          </CardTitle>
          <CardDescription>How you appear to your team and clients across Fernway.</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form aria-labelledby={titleId} noValidate onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 gap-6">
            <CardContent className="grid grid-cols-1 gap-6">
              <div className="flex flex-wrap items-center gap-4 rounded-2xl border bg-muted/40 p-4">
                {photo ? (
                  <img
                    src={photo.src}
                    alt={photo.alt}
                    width={photo.width}
                    height={photo.height}
                    className="size-16 rounded-full object-cover shadow-soft ring-4 ring-card"
                  />
                ) : (
                  <Initials name={profile.displayName} className="size-16 text-lg" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Profile photo</p>
                  <p className="text-sm text-muted-foreground">
                    {photo ? "Shown on projects, comments and the team list." : "No photo yet: your initials are shown on projects, comments and the team list."}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display name</FormLabel>
                      <FormControl>
                        <Input autoComplete="name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" autoComplete="email" inputMode="email" spellCheck={false} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="bio"
                render={({ field }) => {
                  const length = field.value.length;
                  const left = LIMITS.bio - length;
                  return (
                    <FormItem>
                      <FormLabel>Bio</FormLabel>
                      <FormControl>
                        <Textarea rows={4} className="resize-y" placeholder="A line or two about what you do." {...field} />
                      </FormControl>
                      <div className="flex items-start justify-between gap-4">
                        <FormDescription>Up to {LIMITS.bio} characters. Shown on your profile card.</FormDescription>
                        <p aria-hidden="true" className={cn("shrink-0 text-sm tabular-nums", left < 0 ? "font-semibold text-destructive" : "text-muted-foreground")}>
                          {length}/{LIMITS.bio}
                        </p>
                      </div>
                      {/* Spoken only near the limit, so typing isn't interrupted by every keystroke. */}
                      <p aria-live="polite" className="sr-only">
                        {left <= 20 ? (left >= 0 ? `${left} characters left` : `${-left} characters over the limit`) : ""}
                      </p>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              <FormField
                control={form.control}
                name="timeZone"
                render={({ field }) => (
                  <FormItem className="sm:max-w-sm">
                    <FormLabel>Time zone</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger ref={field.ref} onBlur={field.onBlur}>
                          <SelectValue placeholder="Choose a time zone" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TIME_ZONE_OPTIONS.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Used for due dates and reminders. It's {localTime(field.value)} in {place(field.value)} now.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormErrorSummary />
              {saveError && (
                <Alert variant="destructive">
                  <AlertTitle>Profile not saved</AlertTitle>
                  <AlertDescription>{saveError}</AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter className="flex-col-reverse items-stretch gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p role="status" className={cn("flex items-center gap-1.5 text-sm font-medium text-success", !status && "sr-only")}>
                {status && <CircleCheck aria-hidden="true" className="size-4 shrink-0" />}
                {status}
              </p>
              <Button type="submit" loading={form.formState.isSubmitting} className="sm:ml-auto">
                Save changes
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
      <ProfilePreview control={form.control} photo={photo} />
    </div>
  );
}

/** Initials in a circle, for a profile without a photo (decorative: the name is shown next to it). */
function Initials({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full bg-accent font-semibold text-accent-foreground shadow-soft ring-4 ring-card", className)}>
      {initials(name.trim() || "?")}
    </span>
  );
}

/** A live preview of the profile card (updates as you type; reads the form, never saves). */
function ProfilePreview({ control, photo }: { control: Control<Values>; photo: ImageAsset | null }) {
  const [displayName, email, bio, timeZone] = useWatch({ control, name: ["displayName", "email", "bio", "timeZone"] });
  return (
    <Card className="gap-0 overflow-hidden py-0 lg:sticky lg:top-24">
      <div aria-hidden="true" className="h-20 bg-linear-to-r from-primary via-brand-via to-brand-to opacity-90" />
      <CardContent className="-mt-10 grid grid-cols-1 gap-4 px-6 pb-6">
        {/* relative: the banner above has opacity (its own stacking context), which would otherwise paint over the
            photo's top half. */}
        {photo ? (
          <img src={photo.src} alt="" width={photo.width} height={photo.height} className="relative size-20 rounded-full object-cover shadow-soft ring-4 ring-card" />
        ) : (
          <Initials name={displayName} className="relative size-20 text-xl" />
        )}
        <div className="min-w-0">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Preview</h2>
          <p className="mt-1 truncate text-lg font-semibold">{displayName.trim() || "Your name"}</p>
          <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
            <Mail aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{email.trim() || "you@example.com"}</span>
          </p>
        </div>
        <p className="text-sm break-words">{bio.trim() || "No bio yet."}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock aria-hidden="true" className="size-3.5" />
          {localTime(timeZone)} local time · {place(timeZone)}
        </p>
      </CardContent>
    </Card>
  );
}
