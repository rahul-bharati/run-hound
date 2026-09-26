import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";

type InputProps = ComponentProps<"input">;

/**
 * A password <input>'s props with `value` dropped: the field is left uncontrolled, starting from the first value it was
 * given. React mirrors a controlled input's value (and any change to `defaultValue`) into the `value` attribute, which
 * would put the typed password into the page's HTML (a DOM snapshot, a saved page, a session recording). onChange still
 * reports every keystroke, so react-hook-form's field keeps the value; nothing sets it from code.
 */
export function useUncontrolledValue<P extends Pick<InputProps, "value" | "defaultValue">>({ value, defaultValue, ...rest }: P) {
  const [initial] = useState(() => defaultValue ?? value);
  return { ...rest, defaultValue: initial };
}

/**
 * A password field with a show/hide button (CONTRACT.md): the button is named "Show password" / "Hide password"
 * and has aria-pressed (true while the password is shown). Props go to the <input> (id, name, autoComplete,
 * aria-*, ref, className); `wrapperClassName` styles the wrapper. Paste is never blocked. The typed password never
 * reaches the HTML (useUncontrolledValue).
 */
export function PasswordInput({ className, wrapperClassName, ...props }: Omit<InputProps, "type"> & { wrapperClassName?: string }) {
  const [visible, setVisible] = useState(false);
  const inputProps = useUncontrolledValue(props);
  return (
    <div data-slot="password-input" className={cn("relative", wrapperClassName)}>
      <Input type={visible ? "text" : "password"} className={cn("pr-12", className)} {...inputProps} />
      <button
        type="button"
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="absolute top-1/2 right-1 inline-flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visible ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
        <span className="sr-only">{visible ? "Hide password" : "Show password"}</span>
      </button>
    </div>
  );
}
