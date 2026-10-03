/**
 * Facade for the write-side checks' record-state helpers. JSON/form record identity in ./parsing, read snapshots in
 * ./snapshot, GraphQL classification in ./graphql, existing-record hold in ./hold; canonical constants in
 * constants/record-state-constants.ts, type aliases in types/, interfaces in interfaces/.
 */
export { EXISTING_RECORD, NESTED_FORM_KEY } from "../../constants/record-state-constants.js";
export { bodyNamesId, changedFields, holdsId, jsonObjectBody, parseJson } from "./record-state/parsing.js";
export {
  findOwnRecord,
  idLikeKey,
  locateRecord,
  nearest,
  neverWritten,
  readsList,
  recordChains,
  recordId,
  recordWrites,
  requestIO,
  rereadRecord,
  savesOwnRecord,
  snapshotFrom,
  snapshotRecord,
  urlNamesId,
} from "./record-state/snapshot.js";
export { mutationFields, unclearGraphQlSave } from "./record-state/graphql.js";
export {
  changesOnSave,
  changesReadRecord,
  editsExistingRecord,
  getsBefore,
  holdExistingEdits,
  putBackEdited,
  readsBefore,
  recordQueryStamps,
  restoreRecord,
  saveStamp,
  seenBefore,
  serverManaged,
  serverSetField,
  stoppedByHold,
  unclearGraphQlNote,
} from "./record-state/hold.js";

export type { JsonObject, CapturedRequest } from "../../types/record-state.js";
export type { ReadAnswer, RecordIO, RecordSnapshot, SaveHold, StoppedWrite } from "../../interfaces/record-state.js";