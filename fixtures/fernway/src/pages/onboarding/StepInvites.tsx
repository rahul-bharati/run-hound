import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Mail, Plus, X } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormErrorSummary, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { invitesSchema, MAX_INVITES, type InvitesValues } from "./schema";
import { StepHeader } from "./StepHeader";

export interface StepInvitesProps {
  initial: InvitesValues["invites"];
  focusOnMount: boolean;
  /** Back keeps what was typed (not validated). */
  onBack: (invites: InvitesValues["invites"]) => void;
  onSkip: () => void;
  onNext: (invites: InvitesValues["invites"]) => void;
}

/** Step 2, the Invite teammates form: up to 3 optional emails with Add another / Remove, then Back, Skip or Continue. */
export function StepInvites({ initial, focusOnMount, onBack, onSkip, onNext }: StepInvitesProps) {
  const form = useForm<InvitesValues>({ resolver: zodResolver(invitesSchema), defaultValues: { invites: initial } });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "invites" });

  function removeAt(index: number) {
    remove(index);
    // Focus the field before the removed one once React has re-rendered the list.
    requestAnimationFrame(() => form.setFocus(`invites.${Math.max(0, index - 1)}.email`));
  }

  return (
    <Form {...form}>
      <form noValidate aria-labelledby="step-invites-title" onSubmit={form.handleSubmit((values) => onNext(values.invites))} className="grid gap-6">
        <StepHeader
          id="step-invites-title"
          step={2}
          title="Invite teammates"
          description="Fernway works best together. Invite up to 3 people now; you can add more any time from Settings."
          focusOnMount={focusOnMount}
        />

        <ul className="grid gap-4">
          {fields.map((item, index) => (
            <li key={item.id} className="animate-fade-in">
              <FormField
                control={form.control}
                name={`invites.${index}.email`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teammate {index + 1} email</FormLabel>
                    <div className="flex items-center gap-2">
                      <div className="relative min-w-0 flex-1">
                        <Mail aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                        <FormControl>
                          <Input type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="name@studio.com" className="h-11 pl-9" {...field} />
                        </FormControl>
                      </div>
                      {fields.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeAt(index)}>
                          <X aria-hidden="true" />
                          <span className="sr-only">Remove teammate {index + 1}</span>
                        </Button>
                      )}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </li>
          ))}
        </ul>

        {fields.length < MAX_INVITES ? (
          <Button type="button" variant="outline" className="justify-self-start rounded-full" onClick={() => append({ email: "" })}>
            <Plus aria-hidden="true" />
            Add another
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">That's the most for now. You can invite more people later from Settings.</p>
        )}

        <FormErrorSummary />

        <div className="flex flex-wrap items-center gap-2 border-t pt-5">
          <Button type="button" variant="ghost" onClick={() => onBack(form.getValues("invites"))}>
            <ArrowLeft aria-hidden="true" />
            Back
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" onClick={onSkip}>
              Skip
            </Button>
            <Button type="submit" size="lg" className="group">
              Continue
              <ArrowRight aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
}
