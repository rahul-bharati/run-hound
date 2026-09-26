# Works on AI-built apps

This page covers how Run Hound handles apps built with Lovable, Bolt, v0 and similar tools, and where it stops.

Apps from Lovable, Bolt, v0 and similar tools use React, Radix/shadcn components, react-hook-form with zod, sonner toasts and client-side routing. Since 0.4.0 Run Hound handles them:

- **Widgets:** Radix/shadcn, Headless UI, cmdk and MUI selects, comboboxes, checkboxes, switches, radio groups and sliders are found as fields and set the way a person sets them (open, pick an option), in the checks and in the exported specs.
- **Forms in dialogs and sheets:** discovery tries up to 3 buttons that look like they open one ("New project", "Add member", `aria-haspopup="dialog"`), with every write blocked while it looks, and plans the form that appears. Its scenarios open the dialog first after every page load.
- **Schema validation:** optional fields are filled too, and the fields a form refuses when it is sent empty count as required, even when nothing marks them (the empty submit is answered by Run Hound, so nothing is saved). A label such as "Email \*" also marks a field required.
- **Multi-step forms** are tested on their first step. When submitting shows the next step without saving, the checks that need a saved record skip with a "multi-step form" note instead of reporting lost data.
- Toasts count as shown and announced (and are not taken for a saved record), a move to another page after saving is followed, and ids that React or Radix number on each load are never used to find a field.

Limits: only the first step of a multi-step form is tested; forms that appear only after other actions (a menu item, a tab, a hover, or a 4th opener button) aren't found; file inputs are left empty; widgets from other libraries, custom date pickers and rich-text editors may not be recognised. Check the "found" strip above the plan: a field Run Hound couldn't set is named in the notes of the scenarios it skipped.
