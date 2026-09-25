import { Command as CommandPrimitive, useCommandState } from "cmdk";
import { Search } from "lucide-react";
import { useRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

/**
 * cmdk command menu, shadcn/ui style. `label` names the search input (cmdk renders it as a visually hidden
 * <label>), so it is required for accessibility; the default is "Search".
 */
export function Command({ className, label = "Search", ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      label={label}
      className={cn("flex h-full w-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground", className)}
      {...props}
    />
  );
}

/**
 * A command palette in a modal Dialog. `title` is the dialog's (visually hidden) name and the input's label.
 * Pass `shouldFilter={false}` etc. through `commandProps`.
 *
 * It is opened by state (a button, ⌘K), not by a Dialog.Trigger, and Radix only returns focus to a Trigger on
 * close. So the palette remembers what had focus when it opened and puts focus back there when it closes.
 */
export function CommandDialog({
  title = "Command palette",
  description = "Type a command or search, then press Enter.",
  children,
  commandProps,
  ...props
}: ComponentProps<typeof Dialog> & { title?: string; description?: string; commandProps?: ComponentProps<typeof CommandPrimitive> }) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog {...props}>
      <DialogContent
        className="top-[20%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
        showCloseButton={false}
        // Runs before Radix moves focus into the dialog, so activeElement is still what had focus.
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocus.current;
          returnFocus.current = null;
          // A command may have navigated away (the element is gone) or opened another dialog, which has already
          // moved focus into itself by now: leave focus there.
          const inOtherDialog = document.activeElement?.closest('[role="dialog"], [role="alertdialog"]');
          if (target?.isConnected && !inOtherDialog) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command label={title} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold" {...commandProps}>
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="flex h-14 items-center gap-1 border-b px-3">
      <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "flex h-9 w-full rounded-lg bg-transparent px-2 text-base placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm",
          "outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        {...props}
      />
    </div>
  );
}

/**
 * cmdk's listbox. Hidden while nothing matches: a listbox that owns no options is invalid ARIA (axe
 * aria-required-children). Put <CommandEmpty> next to the list, not inside it, so "No results." still shows.
 */
export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  const empty = useCommandState((state) => state.filtered.count === 0);
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      hidden={empty || undefined}
      className={cn("max-h-[min(22rem,60dvh)] scroll-py-1 overflow-x-hidden overflow-y-auto p-1", className)}
      {...props}
    />
  );
}

/**
 * "No results." shown while nothing matches. Render it next to <CommandList> (inside <Command>). The wrapper is a
 * polite status that is always in the DOM, so the message is announced when it appears.
 */
export function CommandEmpty({ className, ...props }: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <div role="status" data-slot="command-empty-status">
      <CommandPrimitive.Empty data-slot="command-empty" className={cn("py-6 text-center text-sm text-muted-foreground", className)} {...props} />
    </div>
  );
}

export function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn("overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * A divider between groups, hidden while searching. Not cmdk's Separator: that one puts role="separator" inside the
 * listbox, which axe reports (aria-required-children); this one is decorative.
 */
export function CommandSeparator({ className, alwaysRender = false, ...props }: ComponentProps<"div"> & { alwaysRender?: boolean }) {
  const searching = useCommandState((state) => state.search !== "");
  if (searching && !alwaysRender) return null;
  return <div data-slot="command-separator" aria-hidden="true" className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2.5 text-sm outline-hidden select-none",
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

/** Keyboard hint at the end of an item (decorative). */
export function CommandShortcut({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="command-shortcut" aria-hidden="true" className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)} {...props} />;
}
