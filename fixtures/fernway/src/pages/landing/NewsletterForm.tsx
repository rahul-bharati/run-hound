import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck, Send } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormErrorSummary, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { apiPost } from "@/lib/api";
import { useBug } from "@/lib/bugs";
import { errorMessage, MESSAGES, showFieldErrors, useGuardedSubmit } from "./forms";

const schema = z.object({
  email: z.string().trim().min(1, MESSAGES.newsletterEmailRequired).email(MESSAGES.emailInvalid),
});

type NewsletterValues = z.input<typeof schema>;

const HEADING_ID = "newsletter-heading";

/**
 * The footer's Newsletter form (CONTRACT.md "/ Landing"): Email address -> POST /api/newsletter, then "Thanks! Check
 * your inbox to confirm." in a role="status". The address is never shown again (the field is cleared).
 * W02: a failed save is swallowed (`catch {}`): no message, no toast.
 */
export function NewsletterForm() {
  const w02 = useBug("W02");
  const [subscribed, setSubscribed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const form = useForm<NewsletterValues, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const confirm = () => {
    form.reset({ email: "" });
    setSubscribed(true);
    toast.success("You're subscribed", { description: "Check your inbox to confirm your address." });
  };

  const onSubmit = useGuardedSubmit(form, async (values) => {
    setSaveError(null);
    setSubscribed(false);
    if (w02) {
      // W02: the AI-typical "fire and forget": any failure is silently dropped.
      try {
        await apiPost("/api/newsletter", values);
        confirm();
      } catch {}
      return;
    }
    try {
      await apiPost("/api/newsletter", values);
      confirm();
    } catch (error) {
      const message = errorMessage(error);
      if (!showFieldErrors(form, error, ["email"])) setSaveError(message);
      toast.error("We couldn't subscribe you", { description: message });
    }
  });

  return (
    <section aria-labelledby={HEADING_ID} className="rounded-2xl border bg-card p-5 shadow-soft">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
          <Send className="size-4" />
        </span>
        <h2 id={HEADING_ID} className="text-base font-semibold tracking-tight">
          Get product updates
        </h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">One short email a month with new features and studio planning tips. Unsubscribe anytime.</p>
      <Form {...form}>
        <form aria-labelledby={HEADING_ID} noValidate onSubmit={onSubmit} className="mt-4 grid gap-3">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email address</FormLabel>
                <div className="flex flex-wrap gap-2">
                  <FormControl>
                    <Input type="email" inputMode="email" autoComplete="email" placeholder="you@studio.com" required className="min-w-40 flex-1" {...field} />
                  </FormControl>
                  <Button type="submit" loading={form.formState.isSubmitting} className="shrink-0">
                    Subscribe
                  </Button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormErrorSummary />
          {saveError && (
            <Alert variant="destructive">
              <AlertTitle>We couldn't subscribe you</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}
          <div role="status" className="empty:-mt-3">
            {subscribed && (
              <p className="flex items-center gap-2 text-sm font-medium text-accent-foreground">
                <MailCheck aria-hidden="true" className="size-4 shrink-0 text-success" />
                Thanks! Check your inbox to confirm.
              </p>
            )}
          </div>
        </form>
      </Form>
    </section>
  );
}
