import { Check, ChevronsUpDown } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command";
import { fieldClasses } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Extra words the filter matches (e.g. a member's role or email). */
  keywords?: string[];
  /** Shown before the label (e.g. an <Avatar>); decorative. */
  icon?: ReactNode;
  /** Secondary line under the label. */
  description?: string;
}

export type ComboboxProps = Omit<ComponentProps<"button">, "value" | "defaultValue" | "onChange" | "children"> & {
  options: readonly ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** Trigger text while nothing is chosen. */
  placeholder?: string;
  /** Label (visually hidden) and placeholder of the search input inside the list. */
  searchLabel?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  contentClassName?: string;
};

/**
 * A filterable single-select: a <button role="combobox" aria-expanded> that opens a Popover with a cmdk list.
 * Like SelectTrigger, the trigger takes `id`, `ref` and aria-* props, so wrap it in <FormControl> (or point a
 * <Label htmlFor> at its id): its accessible name is the visible label.
 */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Select…",
  searchLabel = "Search",
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  className,
  contentClassName,
  disabled,
  ...triggerProps
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          data-slot="combobox-trigger"
          data-placeholder={selected ? undefined : ""}
          className={cn(
            fieldClasses,
            "flex h-10 cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-base sm:text-sm",
            "data-[placeholder]:text-muted-foreground",
            className,
          )}
          {...triggerProps}
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            {selected?.icon}
            <span className="truncate">{selected ? selected.label : placeholder}</span>
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={searchLabel} className={cn("w-(--radix-popover-trigger-width) min-w-64 p-0", contentClassName)}>
        <Command label={searchLabel}>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandEmpty>{emptyText}</CommandEmpty>
          <CommandList>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={[option.label, ...(option.keywords ?? [])]}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  {option.icon}
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{option.label}</span>
                    {option.description && <span className="truncate text-xs text-muted-foreground">{option.description}</span>}
                  </span>
                  <Check aria-hidden="true" className={cn("ml-auto size-4", option.value === value ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
