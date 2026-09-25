/**
 * react-hook-form helpers, shadcn/ui style, wired for Fernway's accessibility contract (CONTRACT.md "Page
 * requirements"):
 *
 * - FormLabel is a visible <label for> the control (id `<item>-control`); it also has an id (`<item>-label`).
 * - FormControl passes to its single child: `id`, `aria-invalid="true"` while the field has an error (absent
 *   otherwise), and `aria-describedby` = the description id (when a FormDescription is rendered) plus the message
 *   id (while there is an error). Every id it references exists in the DOM.
 * - FormMessage renders the visible error text with that message id.
 * - FormErrorSummary is a role="alert" region that announces "the form has errors" after a failed submit.
 *
 * Usage:
 *
 *   const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues });   // validates on submit,
 *   <Form {...form}>                                                                   // then on change
 *     <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
 *       <FormField control={form.control} name="email" render={({ field }) => (
 *         <FormItem>
 *           <FormLabel>Work email</FormLabel>
 *           <FormControl><Input type="email" autoComplete="email" {...field} /></FormControl>
 *           <FormMessage />
 *         </FormItem>
 *       )} />
 *       <FormErrorSummary />
 *       <Button type="submit" loading={form.formState.isSubmitting}>Join waitlist</Button>
 *
 * Radix Select: put FormControl around the SelectTrigger and give the trigger `ref={field.ref}` so the first invalid
 * field can be focused. RadioGroup / Slider (not labelable): use <FormControl labelMode="labelledby"> and pass
 * `htmlFor={undefined}` to FormLabel. Server field errors: form.setError("email", { type: "server", message }).
 */
import { Slot as SlotPrimitive } from "radix-ui";
import { CircleAlert } from "lucide-react";
import { createContext, useContext, useId, useLayoutEffect, useState, type ComponentProps, type Dispatch, type SetStateAction } from "react";
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";
import { cn } from "@/lib/utils";
import { Label } from "./label";

/** react-hook-form's FormProvider: `<Form {...form}>`. */
export const Form = FormProvider;

interface FormFieldContextValue {
  name: string;
}
const FormFieldContext = createContext<FormFieldContextValue | null>(null);

/** A react-hook-form Controller that tells FormItem/FormLabel/FormControl/FormMessage which field they belong to. */
export function FormField<TFieldValues extends FieldValues = FieldValues, TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>>(
  props: ControllerProps<TFieldValues, TName>,
) {
  return (
    <FormFieldContext value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext>
  );
}

interface FormItemContextValue {
  id: string;
  hasDescription: boolean;
  setDescriptionCount: Dispatch<SetStateAction<number>>;
}
const FormItemContext = createContext<FormItemContextValue | null>(null);

/** Groups one field's label, control, description and message (a vertical stack). */
export function FormItem({ className, ...props }: ComponentProps<"div">) {
  const id = useId();
  const [descriptions, setDescriptions] = useState(0);
  return (
    <FormItemContext value={{ id, hasDescription: descriptions > 0, setDescriptionCount: setDescriptions }}>
      <div data-slot="form-item" className={cn("grid gap-2", className)} {...props} />
    </FormItemContext>
  );
}

/** The current field's ids and state. Use inside a FormItem within a FormField. */
export function useFormField() {
  const field = useContext(FormFieldContext);
  const item = useContext(FormItemContext);
  if (!field) throw new Error("useFormField must be used inside <FormField>");
  if (!item) throw new Error("useFormField must be used inside <FormItem>");
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: field.name });
  const fieldState = getFieldState(field.name, formState);
  return {
    name: field.name,
    formItemId: `${item.id}-control`,
    formLabelId: `${item.id}-label`,
    formDescriptionId: `${item.id}-description`,
    formMessageId: `${item.id}-message`,
    hasDescription: item.hasDescription,
    ...fieldState,
  };
}

/** Visible label: <label for={control id} id={label id}>. Turns red while the field has an error. */
export function FormLabel({ className, ...props }: ComponentProps<typeof Label>) {
  const { error, formItemId, formLabelId } = useFormField();
  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      id={formLabelId}
      htmlFor={formItemId}
      className={cn("data-[error=true]:text-destructive", className)}
      {...props}
    />
  );
}

/**
 * Passes id / aria-invalid / aria-describedby (and aria-labelledby with labelMode="labelledby") to its only child.
 * An aria-describedby given on FormControl is kept and merged.
 */
export function FormControl({
  labelMode = "for",
  "aria-describedby": extraDescribedBy,
  ...props
}: ComponentProps<typeof SlotPrimitive.Slot> & { labelMode?: "for" | "labelledby" }) {
  const { error, formItemId, formLabelId, formDescriptionId, formMessageId, hasDescription } = useFormField();
  const describedBy = [extraDescribedBy, hasDescription ? formDescriptionId : null, error ? formMessageId : null].filter(Boolean).join(" ");
  return (
    <SlotPrimitive.Slot
      data-slot="form-control"
      id={formItemId}
      aria-describedby={describedBy || undefined}
      aria-invalid={error ? true : undefined}
      {...(labelMode === "labelledby" ? { "aria-labelledby": formLabelId } : {})}
      {...props}
    />
  );
}

/** Hint text under a field; referenced by the control's aria-describedby while rendered. */
export function FormDescription({ className, ...props }: ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();
  const item = useContext(FormItemContext);
  const register = item?.setDescriptionCount;
  useLayoutEffect(() => {
    register?.((n) => n + 1);
    return () => register?.((n) => n - 1);
  }, [register]);
  return <p data-slot="form-description" id={formDescriptionId} className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

/** The field's visible error message (nothing while valid, unless you pass children). */
export function FormMessage({ className, children, ...props }: ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error.message ?? "") : children;
  if (!body) return null;
  return (
    <p data-slot="form-message" id={formMessageId} className={cn("flex items-start gap-1.5 text-sm font-medium text-destructive", className)} {...props}>
      {error && <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
      <span>{body}</span>
    </p>
  );
}

/**
 * A role="alert" region (mounted from the start, empty until needed) that announces that the form has errors after
 * a failed submit: "There is 1 problem with this form. Check the highlighted field." Visually hidden by default
 * (the fields show their own messages); pass `visible` to show it as a banner. `root` errors
 * (form.setError("root", ...)) are not counted: show those with an <Alert variant="destructive">.
 */
export function FormErrorSummary({ className, visible = false, message }: { className?: string; visible?: boolean; message?: (count: number) => string }) {
  const { errors, submitCount } = useFormState();
  const count = Object.keys(errors).filter((k) => k !== "root").length;
  const text =
    submitCount > 0 && count > 0
      ? (message?.(count) ??
        (count === 1
          ? "There is 1 problem with this form. Check the highlighted field."
          : `There are ${count} problems with this form. Check the highlighted fields.`))
      : "";
  return (
    <div
      data-slot="form-error-summary"
      role="alert"
      className={cn(
        visible && text ? "rounded-xl border border-destructive/40 bg-card px-4 py-3 text-sm font-medium text-destructive" : "sr-only",
        className,
      )}
    >
      {text}
    </div>
  );
}
