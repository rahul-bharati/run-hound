import { Slider as SliderPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Radix Slider. The focusable part is the thumb (role="slider", 24x24), so naming props (aria-label,
 * aria-labelledby, aria-describedby, aria-invalid), `id` and `ref` are moved from the root onto the thumb(s).
 * `valueText` sets aria-valuetext (e.g. v => `$${v.toLocaleString()}`).
 */
export function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  id,
  valueText,
  ref,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root> & { valueText?: (value: number) => string }) {
  const thumbAria = {
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
  };
  const values = Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min];
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center py-1 select-none data-[disabled]:opacity-60 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative grow overflow-hidden rounded-full bg-muted data-[orientation=horizontal]:h-2 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute bg-linear-to-r from-primary to-brand-via data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
        />
      </SliderPrimitive.Track>
      {values.map((v, i) => (
        <SliderPrimitive.Thumb
          key={i}
          ref={i === 0 ? (ref as ComponentProps<typeof SliderPrimitive.Thumb>["ref"]) : undefined}
          id={i === 0 ? id : undefined}
          data-slot="slider-thumb"
          {...thumbAria}
          aria-valuetext={valueText ? valueText(v) : undefined}
          className={cn(
            "block size-6 shrink-0 cursor-grab rounded-full border-2 border-primary bg-card shadow-md transition-colors",
            "outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "active:cursor-grabbing disabled:pointer-events-none",
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
}
