import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Info, Sparkles } from "lucide-react";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormDescription, FormErrorSummary, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "@/components/ui/sonner";
import { apiPost } from "@/lib/api";
import { useBug } from "@/lib/bugs";
import { setSessionUser } from "@/lib/session";
import { useDocumentTitle } from "@/lib/utils";
import { SignupArt } from "./auth/art";
import { AuthLayout } from "./auth/AuthLayout";
import { AuthInput, AuthPasswordInput, FieldControl, GoogleMark, PasswordStrengthMeter } from "./auth/fields";
import { applyServerFieldErrors, toApiError } from "./auth/form-errors";
import { firstName, signupSchema, type AccountUser, type SignupValues } from "./auth/schemas";

const FIELDS = ["name", "email", "password", "company", "terms"] as const;
const FAILED = "Couldn't create your account";
const GOOGLE_NOTE = "Google sign-in isn't set up in this demo";

/** /signup: the Create account form (CONTRACT.md "/signup Create account"). W07 removes the inputs' focus ring. */
export default function Signup() {
  useDocumentTitle("Create account");
  const noFocusRing = useBug("W07");
  const navigate = useNavigate();
  const titleId = useId();
  const strengthId = useId();
  const [googleNote, setGoogleNote] = useState(false);

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "", company: "", terms: false },
  });
  const password = useWatch({ control: form.control, name: "password" });
  const serverError = form.formState.errors.root?.server?.message;

  async function onSubmit(values: SignupValues) {
    try {
      const user = await apiPost<AccountUser>("/api/signup", values);
      setSessionUser({ name: user.name, email: user.email });
      toast.success(`Welcome to Fernway, ${firstName(user.name)}!`, { description: "Your account is ready. Next, set up your workspace." });
      navigate("/onboarding", { state: { welcome: user.name } });
    } catch (err) {
      const error = toApiError(err);
      const fieldMessage = applyServerFieldErrors(form, error, FIELDS);
      if (fieldMessage) {
        toast.error(FAILED, { description: fieldMessage });
        return;
      }
      form.setError("root.server", { type: String(error.status), message: error.message });
      toast.error(FAILED, { description: error.message });
    }
  }

  function continueWithGoogle() {
    setGoogleNote(true);
    toast(GOOGLE_NOTE, { description: "Create an account with your email instead." });
  }

  return (
    <AuthLayout asideLabel="What studios say about Fernway" aside={<SignupArt />}>
      <div className="mb-7">
        <p className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
          <Sparkles aria-hidden="true" className="size-3.5" />
          14-day Studio trial · no card needed
        </p>
        <h1 id={titleId} className="mt-4 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          Create your account
        </h1>
        <p className="mt-2 text-muted-foreground">Plan projects, balance workloads and keep every client in the loop.</p>
      </div>

      <div className="rounded-2xl border bg-card/95 p-5 shadow-soft backdrop-blur-sm sm:p-7">
        <Button type="button" variant="outline" size="lg" className="w-full" onClick={continueWithGoogle}>
          <GoogleMark />
          Continue with Google
        </Button>
        <div role="status">
          {googleNote && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-info/30 bg-card px-3 py-2.5 text-sm">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
              <span>{GOOGLE_NOTE}. Create an account with your email below.</span>
            </p>
          )}
        </div>

        <div className="my-6 flex items-center gap-3 text-xs font-medium text-muted-foreground">
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
          or sign up with email
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>

        <Form {...form}>
          <form noValidate aria-labelledby={titleId} onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FieldControl>
                    <AuthInput noFocusRing={noFocusRing} autoComplete="name" required placeholder="Maya Patel" {...field} />
                  </FieldControl>
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
                  <FieldControl>
                    <AuthInput
                      noFocusRing={noFocusRing}
                      type="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      placeholder="maya@studio.com"
                      {...field}
                    />
                  </FieldControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FieldControl describedBy={strengthId}>
                    <AuthPasswordInput noFocusRing={noFocusRing} autoComplete="new-password" required placeholder="8+ characters" {...field} />
                  </FieldControl>
                  <PasswordStrengthMeter id={strengthId} password={password} />
                  <FormDescription>Use 8 or more characters. Longer passwords with numbers and symbols are stronger.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="company"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-baseline justify-between gap-3">
                    <FormLabel>Company</FormLabel>
                    <span className="text-xs text-muted-foreground">Optional</span>
                  </div>
                  <FieldControl>
                    <AuthInput noFocusRing={noFocusRing} autoComplete="organization" placeholder="Juniper Studio" {...field} />
                  </FieldControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="terms"
              render={({ field }) => (
                <FormItem className="gap-1.5">
                  <div className="flex items-start gap-3">
                    <FieldControl>
                      <Checkbox
                        ref={field.ref}
                        name={field.name}
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                        onBlur={field.onBlur}
                        required
                        className="mt-px"
                      />
                    </FieldControl>
                    <FormLabel className="leading-6 font-normal text-muted-foreground">
                      <span>
                        I agree to the <span className="font-semibold text-foreground">Terms</span> and{" "}
                        <span className="font-semibold text-foreground">Privacy Policy</span>
                      </span>
                    </FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormErrorSummary />
            {serverError && (
              <Alert variant="destructive">
                <AlertTitle>{FAILED}</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" size="lg" className="group w-full" loading={form.formState.isSubmitting}>
              Create account
              {!form.formState.isSubmitting && <ArrowRight aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />}
            </Button>
          </form>
        </Form>
      </div>

      <p className="mt-6 text-center text-sm">
        <Link
          to="/login"
          className="inline-flex min-h-6 items-center gap-1 rounded-md text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Already have an account? <span className="font-semibold text-primary underline-offset-4 hover:underline">Sign in</span>
        </Link>
      </p>
    </AuthLayout>
  );
}
