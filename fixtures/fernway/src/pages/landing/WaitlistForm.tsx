import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, PartyPopper } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormErrorSummary, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { apiPost } from "@/lib/api";
import { useBug } from "@/lib/bugs";
import { errorMessage, MESSAGES, showFieldErrors, TEAM_SIZES, useGuardedSubmit } from "./forms";

const schema = z.object({
  email: z.string().trim().min(1, MESSAGES.emailRequired).email(MESSAGES.emailInvalid),
  teamSize: z.string().min(1, MESSAGES.teamSizeRequired),
});

type WaitlistValues = z.input<typeof schema>;

interface WaitlistEntry {
  id: string;
  email: string;
  teamSize: string;
  position: number;
}

export const WAITLIST_HEADING_ID = "waitlist-heading";

/**
 * The hero's Waitlist form (CONTRACT.md "/ Landing"): Work email + Team size (Radix Select) -> POST /api/waitlist,
 * then "You're #<position> on the list" in a role="status". The page never lists entries, so the form is cleared on
 * success. W01: the Team size label is not associated with the Select trigger (no accessible name).
 */
export function WaitlistForm() {
  const w01 = useBug("W01");
  const [position, setPosition] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const form = useForm<WaitlistValues, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", teamSize: "" },
  });

  const onSubmit = useGuardedSubmit(form, async (values) => {
    setSaveError(null);
    setPosition(null);
    try {
      const entry = await apiPost<WaitlistEntry>("/api/waitlist", values);
      form.reset({ email: "", teamSize: "" });
      setPosition(entry.position);
      toast.success("You're on the list!", { description: `You're #${entry.position}. We'll email you when your invite is ready.` });
    } catch (error) {
      const message = errorMessage(error);
      if (!showFieldErrors(form, error, ["email", "teamSize"])) setSaveError(message);
      toast.error("We couldn't add you to the waitlist", { description: message });
    }
  });

  const pending = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form aria-labelledby={WAITLIST_HEADING_ID} noValidate onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10.5rem]">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Work email</FormLabel>
                <FormControl>
                  <Input type="email" inputMode="email" autoComplete="email" placeholder="you@studio.com" required {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="teamSize"
            render={({ field }) => (
              <FormItem>
                {/* W01: an AI-typical slip: the label is shown but points at nothing, so the trigger has no name. */}
                {w01 ? <FormLabel htmlFor={undefined}>Team size</FormLabel> : <FormLabel>Team size</FormLabel>}
                <Select value={field.value} onValueChange={field.onChange} disabled={field.disabled}>
                  <FormControl>
                    <SelectTrigger ref={field.ref} onBlur={field.onBlur} aria-required="true">
                      <SelectValue placeholder="Select size" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {TEAM_SIZES.map((size) => (
                      <SelectItem key={size} value={size}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormErrorSummary />
        {saveError && (
          <Alert variant="destructive">
            <AlertTitle>We couldn't add you to the waitlist</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" size="lg" loading={pending} className="w-full rounded-xl shadow-glow">
          Join waitlist
          {!pending && <ArrowRight aria-hidden="true" />}
        </Button>

        <div role="status" className="empty:-mt-4">
          {position !== null && (
            <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-accent px-4 py-3 text-sm text-accent-foreground animate-scale-in">
              <PartyPopper aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <p>
                <span className="font-semibold">You're #{position} on the list</span>
                <span className="block">We'll email you as soon as your invite is ready.</span>
              </p>
            </div>
          )}
        </div>
      </form>
    </Form>
  );
}
