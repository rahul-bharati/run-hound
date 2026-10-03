/**
 * Record id predicates for write-access: isIdParam (a query parameter name that names an id), isIdValue (a value
 * is the record's id), sameValue (a === b or JSON-equal), idEndingIn (a scenario id ends in the slug the way the
 * planner makes it).
 */

/** True when a query parameter named `name` carries a record id: the id's own key, or a name that ends in id (task_id, taskId). */
export const isIdParam = (name: string, key: string) => name === key || /(^|[_-])id$/i.test(name) || /[a-z]Id$/.test(name);

/** True when `value` is the record's id: the same value, or the same number or text in the other form (a form body's "3"). */
export const isIdValue = (value: unknown, id: { key: string; value: string | number }) =>
  sameValue(value, id.value) || ((typeof value === "string" || typeof value === "number") && String(value) === String(id.value));

export const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * A scenario id that ends in `slug`, as the planner makes it (plan.ts buildPlan): after a colon (the check's id, and
 * again on a collision), then a later form's "@form-<n>" and a collision's "#<n>". The same shape
 * runner.needsOtherAccount matches to sign Account B in.
 */
export const idEndingIn = (slug: string) => new RegExp(`(?:^|:)${slug}(?:@form-\\d+)?(?:#\\d+)?$`);
