import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarCheck, CalendarDays, Video } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormErrorSummary, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { apiPost } from "@/lib/api";
import { cn, todayIso } from "@/lib/utils";
import { COMPANY_SIZES, errorMessage, MESSAGES, showFieldErrors, useGuardedSubmit } from "./forms";

const schema = z.object({
  name: z.string().trim().min(1, MESSAGES.nameRequired).max(100, MESSAGES.nameTooLong),
  email: z.string().trim().min(1, MESSAGES.emailRequired).email(MESSAGES.emailInvalid),
  companySize: z.string().min(1, MESSAGES.companySizeRequired),
  date: z
    .string()
    .min(1, MESSAGES.dateRequired)
    .refine((value) => value >= todayIso(), MESSAGES.datePast),
  message: z.string().trim().max(1000, MESSAGES.messageTooLong),
  consent: z.boolean().refine((value) => value, MESSAGES.consentRequired),
});

type DemoValues = z.input<typeof schema>;

const EMPTY: DemoValues = { name: "", email: "", companySize: "", date: "", message: "", consent: false };
const FIELDS = ["name", "email", "companySize", "date", "message", "consent"] as const;

/**
 * "Book a demo": a trigger button, a Radix Dialog with the Demo form (POST /api/demo-requests) and, after a
 * successful request, an inline role="status" confirmation next to the trigger. Esc and "Close" return focus to the
 * trigger (Radix). Values survive closing and reopening until the request succeeds.
 */
export function DemoDialog({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const form = useForm<DemoValues, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  const onSubmit = useGuardedSubmit(form, async (values) => {
    setSaveError(null);
    setRequested(false);
    try {
      await apiPost("/api/demo-requests", values);
      form.reset(EMPTY);
      setOpen(false);
      setRequested(true);
      toast.success("Demo requested", { description: "We'll email you within one business day to confirm a time." });
    } catch (error) {
      const message = errorMessage(error);
      if (!showFieldErrors(form, error, FIELDS)) setSaveError(message);
      toast.error("We couldn't send your demo request", { description: message });
    }
  });

  return (
    <div className={cn("flex flex-col items-start gap-3", className)}>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="lg" className="rounded-xl">
            <CalendarDays aria-hidden="true" />
            Book a demo
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <span aria-hidden="true" className="mb-2 grid size-11 place-items-center rounded-2xl bg-accent text-accent-foreground shadow-soft">
              <Video className="size-5" />
            </span>
            <DialogTitle>Book a demo</DialogTitle>
            <DialogDescription>Pick a day and we'll show your team around Fernway in a 30-minute video call.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form aria-label="Book a demo" noValidate onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full name</FormLabel>
                      <FormControl>
                        <Input autoComplete="name" required {...field} />
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
                      <FormLabel>Work email</FormLabel>
                      <FormControl>
                        <Input type="email" inputMode="email" autoComplete="email" required {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="companySize"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company size</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange} disabled={field.disabled}>
                        <FormControl>
                          <SelectTrigger ref={field.ref} onBlur={field.onBlur} aria-required="true">
                            <SelectValue placeholder="Select size" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {COMPANY_SIZES.map((size) => (
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
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Preferred date</FormLabel>
                      <FormControl>
                        <Input type="date" min={todayIso()} required {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="message"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>What would you like to see?</FormLabel>
                    <FormControl>
                      <Textarea rows={3} maxLength={1000} placeholder="Client portals, workload planning, importing from spreadsheets…" {...field} />
                    </FormControl>
                    <FormDescription>Optional. We'll tailor the call to your studio.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="consent"
                render={({ field }) => (
                  <FormItem className="gap-1.5">
                    <div className="flex items-center gap-2.5">
                      <FormControl>
                        <Checkbox
                          ref={field.ref}
                          checked={field.value}
                          onCheckedChange={(checked) => field.onChange(checked === true)}
                          onBlur={field.onBlur}
                          name={field.name}
                          aria-required="true"
                        />
                      </FormControl>
                      <FormLabel className="font-normal">I agree to be contacted</FormLabel>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormErrorSummary />
              {saveError && (
                <Alert variant="destructive">
                  <AlertTitle>We couldn't send your demo request</AlertTitle>
                  <AlertDescription>{saveError}</AlertDescription>
                </Alert>
              )}

              <DialogFooter className="pt-1">
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" loading={form.formState.isSubmitting}>
                  Request demo
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      <div role="status" className="empty:-mt-3">
        {requested && (
          <p className="flex items-center gap-2 rounded-xl border border-success/30 bg-accent px-3 py-2 text-sm font-medium text-accent-foreground">
            <CalendarCheck aria-hidden="true" className="size-4 shrink-0" />
            Thanks! We'll email you within one business day to confirm your demo.
          </p>
        )}
      </div>
    </div>
  );
}
