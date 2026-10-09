/**
 * The messages the main process has for the user, waiting for the UI to ask (D8). They replace native message boxes:
 * the UI takes them over the notices channel once, when it loads, and shows each as an in-app banner. Pure, so the
 * take-once behaviour is unit tested.
 */

import type { DesktopNotice } from "./contract.js";

export interface NoticeQueue {
  /** Keeps a notice until the UI takes it. */
  add(notice: DesktopNotice): void;
  /** Returns every waiting notice, oldest first, and forgets them: a second call returns []. */
  take(): DesktopNotice[];
}

export function createNoticeQueue(): NoticeQueue {
  let waiting: DesktopNotice[] = [];
  return {
    add: (notice) => void waiting.push(notice),
    take: () => {
      const taken = waiting;
      waiting = [];
      return taken;
    },
  };
}
