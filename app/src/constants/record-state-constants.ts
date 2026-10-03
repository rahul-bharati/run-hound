/** Pure data reused by the write-side checks' record-state helpers. */

/** Forms whose save changes the account itself, not a record: never used for the test record (as access-control). */
export const ACCOUNT_FORM =
  /\b(passwords?|passcode|e-?mail|two[\s-]?factor|2fa|mfa|security|sign\s?-?(in|up|out)|log\s?-?(in|out)|register|delete|close\s+(my\s+)?account|deactivate|username)\b/i;

/**
 * Keys that are a record's own id whatever the record is, in the order they are looked for: id, _id, uuid, Django's pk,
 * Parse's objectId, guid.
 */
export const ID_KEYS = ["id", "_id", "uuid", "pk", "objectId", "guid"];

/** A form key that nests a field under the model's name (Rails, PHP): task[title] is the record's `title`. */
export const NESTED_FORM_KEY = /^([^[\]]+)\[([^[\]]+)\]$/;

/** Plurals the suffix rules of modelNames get wrong, as Rails singularizes them: /api/people/7 updates a person. */
export const IRREGULAR_PLURALS = new Map([
  ["people", "person"],
  ["children", "child"],
  ["men", "man"],
  ["women", "woman"],
  ["media", "medium"],
  ["criteria", "criterion"],
  ["indices", "index"],
  ["analyses", "analysis"],
]);

/**
 * Endpoints no write-side check ever writes to, even with --allow-destructive (docs/v2-spec.md "Safety contract"):
 * sign-out, password, email, account deletion, payment or checkout, invitations and sharing, plus any path that acts
 * when loaded (deep-links' rule).
 */
export const NEVER_WRITTEN =
  /\b(log ?out|log ?off|sign ?out|passwords?|passcode|e ?mails?|delete account|account delete|deactivate|close account|checkout|payments?|pay|billing|stripe|paypal|paddle|invit\w*|share|sharing|shared with|collaborators?)\b/i;

/**
 * The reason a write-side check gives when its form changes a record Account A already had. csrf and write-access
 * create their test record through the form, as Account A, so a form that edits a record instead is never used.
 */
export const EXISTING_RECORD =
  "Skipped: this form changes a record Account A already had, not a new one, and Run Hound only ever writes to a record it created in this run.";

/** How a save's body is encoded, judged from the body itself (the capture keeps no request headers). */
export const CONTENT_TYPE = { json: "application/json", form: "application/x-www-form-urlencoded" } as const;

/**
 * Field names an app sets itself, never the person using it, compared lower case with letters and digits only: the
 * record's id, when it was created or last changed and by whom, and its version or lock token (updatedAt, updated_at,
 * modified_on, lastModified, createdBy, createdById, createTime, update_time, lastUpdate, modification_date,
 * creationTimestamp, Directus's user_created and user_updated, version, lock_version, rowVersion, resourceVersion, etag,
 * @odata.etag, _rev, revision). A present-tense verb needs its suffix (updateTime, not update), and only "last" makes a
 * bare one a stamp (lastUpdate): a bare "update", "change" or "edit" is the record's own data.
 */
export const SERVER_SET_NAME =
  /^(id|uuid|guid|(last)?(created|inserted|updated|modified|changed|edited)(at|on|date|time|timestamp|by(id|userid)?)?|(last)?(create|insert|update|modify|modification|change|edit)(at|on|date|time|timestamp|by(id|userid)?)|last(update|modification|change|edit)|date(created|inserted|updated|modified|changed)|user(created|updated|modified)|creation(date|time|timestamp)|(lock|row|record|object|resource|entity)?version(id|number)?|rev|revision|etag|odataetag|concurrencystamp)$/;

/** Keys only a document store sets, matched as written: Mongoose's version key, Cosmos DB's system properties. */
export const SERVER_SET_KEYS = new Set(["__v", "_ts", "_rid", "_self", "_attachments"]);

/** Document-store keys fixed once the record exists, matched as written: Cosmos DB's resource id and links. */
export const FIXED_KEYS = new Set(["_rid", "_self", "_attachments"]);

/** The query parameters of a GraphQL-over-HTTP GET that sends a persisted document by its id (Relay, Hot Chocolate). */
export const PERSISTED_GET_KEYS = new Set(["doc_id", "documentId", "variables", "operationName", "extensions"]);

/** The keys of a persisted operation sent by its id under `id` (Hot Chocolate, Strawberry Shake). */
export const PERSISTED_ID_KEYS = new Set(["id", "variables", "operationName", "extensions"]);

/** Relay's clientMutationId names no record: it only pairs a mutation with its answer. */
export const NOT_A_RECORD_ID = new Set(["clientMutationId"]);

/**
 * Verbs that say a mutation makes a new record when they lead its name: createTask, insert_tasks_one, addComment,
 * newTask, postComment, sendMessage. Some are nouns too (likePost, pinLog), so only the first word counts.
 */
export const CREATE_WORDS = new Set(["create", "add", "new", "insert", "post", "submit", "send", "upload", "book", "place", "make", "log"]);
/** The verbs that also say it at the end of the name, Shopify's way (productCreate, taskAdd): never a noun. */
export const CREATE_LAST = new Set(["create", "add", "insert"]);
/**
 * Nouns for the one record of its kind an account has (0.6.0 close-out round 2): a create verb before one saves that
 * record, it makes no new one (submitProfile, sendSettings, postMyPreferences, accountCreate).
 */
export const SINGLETON_NOUNS = new Set(["profile", "settings", "setting", "preferences", "preference", "prefs", "account", "me", "viewer"]);
/** Words that say it changes one that is there: updateTask, upsertTask, saveSettings, renameTask, setTheme. */
export const EDIT_WORDS = new Set([
  "update", "edit", "set", "change", "rename", "save", "upsert", "patch", "replace", "delete", "remove", "toggle", "move", "archive",
  "mark", "complete", "modify", "assign", "unassign", "reorder", "merge", "restore", "clear", "reset", "destroy", "unset", "put",
]);