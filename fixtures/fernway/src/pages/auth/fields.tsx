/**
 * Field pieces shared by /signup and /login, with the two planted bugs switchable per field:
 *
 * - W07 (`noFocusRing`): the text inputs are rendered the way an AI builder "tidies up" the focus outline, with
 *   `outline-none` and no ring, border or shadow change on focus, so keyboard focus is invisible.
 * - W10 (`announce={false}`): the control keeps its id (so its <label for> still names it) but gets no aria-invalid
 *   and no aria-describedby: the error text under it is red text only.
 */
import { Eye, EyeOff } from "lucide-react";
import { Slot as SlotPrimitive } from "radix-ui";
import { useState, type ComponentProps, type ReactElement } from "react";
import { FormControl, useFormField } from "@/components/ui/form";
import { fieldClasses, Input } from "@/components/ui/input";
import { PasswordInput, useUncontrolledValue } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";
import { passwordStrength } from "./schemas";

/** fieldClasses without any focus style: what W07 ships. */
const bareFieldClasses = fieldClasses
  .split(/\s+/)
  .filter((c) => c && !c.includes("focus-visible:") && c !== "outline-hidden")
  .join(" ");

type InputProps = ComponentProps<"input"> & { noFocusRing?: boolean };

/** The shared Input, or under W07 a plain <input> with `outline-none focus:outline-none` and no ring. */
export function AuthInput({ noFocusRing = false, className, type = "text", ...props }: InputProps) {
  if (!noFocusRing) return <Input type={type} className={className} {...props} />;
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(bareFieldClasses, "h-10 px-3 py-2 text-base outline-none focus:outline-none sm:text-sm", className)}
      {...props}
    />
  );
}

/**
 * Same markup and behaviour as the shared PasswordInput (show/hide button "Show password" / "Hide password", the typed
 * password kept out of the HTML), W07 input inside.
 */
function BarePasswordInput({ className, wrapperClassName, ...props }: Omit<ComponentProps<"input">, "type"> & { wrapperClassName?: string }) {
  const [visible, setVisible] = useState(false);
  const inputProps = useUncontrolledValue(props);
  return (
    <div data-slot="password-input" className={cn("relative", wrapperClassName)}>
      <AuthInput noFocusRing type={visible ? "text" : "password"} className={cn("pr-12", className)} {...inputProps} />
      <button
        type="button"
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="absolute top-1/2 right-1 inline-flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors outline-hidden hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visible ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
        <span className="sr-only">{visible ? "Hide password" : "Show password"}</span>
      </button>
    </div>
  );
}

/** The shared PasswordInput, or its W07 twin. */
export function AuthPasswordInput({ noFocusRing = false, ...props }: Omit<ComponentProps<"input">, "type"> & { wrapperClassName?: string; noFocusRing?: boolean }) {
  return noFocusRing ? <BarePasswordInput {...props} /> : <PasswordInput {...props} />;
}

/**
 * Wires the control into its FormItem: FormControl (id, aria-invalid, aria-describedby) normally; under W10 only
 * the id. Extra aria-describedby ids (a meter, a status) are kept in both cases.
 */
export function FieldControl({ announce = true, describedBy, children }: { announce?: boolean; describedBy?: string; children: ReactElement }) {
  const { formItemId } = useFormField();
  if (announce) return <FormControl aria-describedby={describedBy}>{children}</FormControl>;
  return (
    <SlotPrimitive.Slot id={formItemId} aria-describedby={describedBy}>
      {children}
    </SlotPrimitive.Slot>
  );
}

const TONES = {
  1: { bar: "bg-destructive", text: "text-destructive" },
  2: { bar: "bg-warning", text: "text-warning" },
  3: { bar: "bg-success", text: "text-success" },
} as const;

/** Three-segment strength meter; the word (Weak / Fair / Strong) is in a role="status" so it is announced. */
export function PasswordStrengthMeter({ password, id }: { password: string; id: string }) {
  const { level, label } = passwordStrength(password);
  const tone = level === 0 ? null : TONES[level];
  return (
    <div className="flex items-center gap-3">
      <div aria-hidden="true" className="grid flex-1 grid-cols-3 gap-1.5">
        {[1, 2, 3].map((n) => (
          <span key={n} className={cn("h-1.5 rounded-full bg-muted-foreground/15 transition-colors duration-300", tone && n <= level && tone.bar)} />
        ))}
      </div>
      <p role="status" id={id} className={cn("min-w-14 text-right text-xs font-semibold", tone?.text)}>
        {label && (
          <>
            <span className="sr-only">Password strength: </span>
            {label}
          </>
        )}
      </p>
    </div>
  );
}

/** A four-colour "G" for the Continue with Google button (decorative). */
export function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={cn("size-5", className)}>
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.05H12v3.88h5.39a4.6 4.6 0 0 1-2 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.36z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.41l-3.23-2.51c-.9.6-2.04.96-3.39.96-2.6 0-4.81-1.76-5.6-4.12H3.07v2.59A10 10 0 0 0 12 22z" />
      <path fill="#FBBC05" d="M6.4 13.92a6 6 0 0 1 0-3.84V7.49H3.07a10 10 0 0 0 0 9.02z" />
      <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A10 10 0 0 0 3.07 7.49L6.4 10.08C7.19 7.72 9.4 5.96 12 5.96z" />
    </svg>
  );
}
