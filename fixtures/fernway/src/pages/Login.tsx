import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, KeyRound, LayoutDashboard } from "lucide-react";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormErrorSummary, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "@/components/ui/sonner";
import { apiPost } from "@/lib/api";
import { useBug } from "@/lib/bugs";
import { setSessionUser } from "@/lib/session";
import { useDocumentTitle } from "@/lib/utils";
import { LoginArt } from "./auth/art";
import { AuthLayout } from "./auth/AuthLayout";
import { AuthInput, AuthPasswordInput, FieldControl } from "./auth/fields";
import { applyServerFieldErrors, toApiError } from "./auth/form-errors";
import { firstName, loginSchema, safeNext, type AccountUser, type LoginValues } from "./auth/schemas";

const FIELDS = ["email", "password"] as const;
const FAILED = "Couldn't sign you in";

const linkClasses =
  "rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * /login: the Sign in form (CONTRACT.md "/login Sign in"). A 401 is the app working: it is shown in a role="alert"
 * above the form, without a toast. W10 shows the sign-in errors (field validation and the 401) as red text only:
 * nothing marked, linked or announced. Server failures are unchanged under W10 (alert + toast), like Kennel's A05,
 * so only error-announcement catches it.
 */
export default function Login() {
  useDocumentTitle("Sign in");
  const announce = !useBug("W10");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { hash, search } = useLocation();
  const titleId = useId();

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", remember: false },
  });
  const failure = form.formState.errors.root?.server;
  const refused = failure?.type === "401";

  async function onSubmit(values: LoginValues) {
    try {
      const user = await apiPost<AccountUser>("/api/login", values);
      setSessionUser({ name: user.name, email: user.email });
      toast.success(`Welcome back, ${firstName(user.name)}!`);
      navigate(safeNext(params.get("next")));
    } catch (err) {
      const error = toApiError(err);
      if (error.status !== 401 && applyServerFieldErrors(form, error, FIELDS)) return;
      form.setError("root.server", { type: String(error.status), message: error.message });
      // Refused credentials are the form doing its job: the alert says so, a toast would only repeat it.
      if (error.status !== 401) toast.error(FAILED, { description: error.message });
    }
  }

  const failureTitle = refused ? failure?.message : FAILED;
  const failureDetail = refused ? "Check your email and password and try again." : failure?.message;

  return (
    <AuthLayout asideLabel="Why studios sign in every morning" aside={<LoginArt />}>
      <div className="mb-7">
        <h1 id={titleId} className="text-3xl font-bold tracking-tight sm:text-4xl">
          Welcome back
        </h1>
        <p className="mt-2 text-muted-foreground">Sign in to plan, track and ship your studio's work.</p>
      </div>

      <div className="rounded-2xl border bg-card/95 p-5 shadow-soft backdrop-blur-sm sm:p-7">
        {failure &&
          (refused && !announce ? (
            // W10: the refusal is red text only. (Server failures keep their alert, so only sign-in errors change.)
            <p className="mb-5 text-sm font-medium text-destructive">{failure.message}</p>
          ) : (
            <Alert variant="destructive" className="mb-5">
              <AlertTitle>{failureTitle}</AlertTitle>
              <AlertDescription>{failureDetail}</AlertDescription>
            </Alert>
          ))}

        <Form {...form}>
          <form noValidate aria-labelledby={titleId} onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FieldControl announce={announce}>
                    <AuthInput type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required placeholder="you@studio.com" {...field} />
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
                  <div className="flex items-center justify-between gap-3">
                    <FormLabel>Password</FormLabel>
                    <Link to={{ pathname: "/login", search, hash: "#forgot" }} className={`${linkClasses} inline-flex min-h-6 items-center text-sm font-medium text-primary underline-offset-4 hover:underline`}>
                      Forgot password?
                    </Link>
                  </div>
                  <FieldControl announce={announce}>
                    <AuthPasswordInput autoComplete="current-password" required {...field} />
                  </FieldControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="remember"
              render={({ field }) => (
                <FormItem className="flex items-center gap-3">
                  <FieldControl announce={announce}>
                    <Checkbox ref={field.ref} name={field.name} checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} onBlur={field.onBlur} />
                  </FieldControl>
                  <FormLabel className="font-normal text-muted-foreground">Remember me</FormLabel>
                </FormItem>
              )}
            />

            {announce && <FormErrorSummary />}

            <Button type="submit" size="lg" className="group w-full" loading={form.formState.isSubmitting}>
              Sign in
              {!form.formState.isSubmitting && <ArrowRight aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />}
            </Button>
          </form>
        </Form>

        <div id="forgot" role="status" className="scroll-mt-24">
          {hash === "#forgot" && (
            <div className="mt-5 flex items-start gap-3 rounded-xl border border-info/30 bg-card p-4 text-sm">
              <KeyRound aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
              <div className="grid gap-0.5">
                <p className="font-semibold">Password resets aren't available in this demo.</p>
                <p className="text-muted-foreground">Create a new account, or explore the demo workspace without signing in.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-3 text-sm">
        <Link to="/signup" className={`${linkClasses} inline-flex min-h-6 items-center gap-1 text-muted-foreground hover:text-foreground`}>
          New to Fernway? <span className="font-semibold text-primary underline-offset-4 hover:underline">Create an account</span>
        </Link>
        <Link
          to="/app"
          className={`${linkClasses} inline-flex min-h-6 items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground`}
        >
          <LayoutDashboard aria-hidden="true" className="size-4" />
          Explore the demo workspace
        </Link>
      </div>
    </AuthLayout>
  );
}
