import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";

/**
 * A password field with a show/hide button (CONTRACT.md): the button is named "Show password" / "Hide password"
 * and has aria-pressed (true while the password is shown). Props go to the <input> (id, name, autoComplete,
 * aria-*, ref, className); `wrapperClassName` styles the wrapper. Paste is never blocked.
 */
export function PasswordInput({ className, wrapperClassName, ...props }: Omit<ComponentProps<"input">, "type"> & { wrapperClassName?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div data-slot="password-input" className={cn("relative", wrapperClassName)}>
      <Input type={visible ? "text" : "password"} className={cn("pr-12", className)} {...props} />
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
