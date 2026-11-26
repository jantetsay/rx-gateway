// The rule thresholds. Same for every client; Steve approves any change, and a
// change bumps the version so reports show which rules they were computed with.

export const RULES = {
  version: "2026.11-1",
  task: {
    /** Yellow when due within this many working days with no recent update. */
    dueSoonWorkingDays: 3,
    /** What "no update" means for a task that is due soon. */
    noUpdateWorkingDays: 3,
  },
  gate: {
    /** Yellow when a required signer is unnamed this close to the sitting. */
    signerUnnamedWithinWorkingDays: 10,
  },
  project: {
    /** Slip of 1 to this many working days is yellow; more is red. */
    slipYellowMaxWorkingDays: 10,
    /** An L4 connection unacknowledged longer than this is yellow. */
    l4UnacknowledgedCalendarDays: 14,
    /** No update for this long shows a stale badge, whatever the color. */
    staleCalendarDays: 7,
  },
  escalation: {
    level1DueSoonWorkingDays: 3,
    level2OverdueWorkingDays: 3,
    level2BlockerWorkingDays: 2,
    level3CriticalOverdueWorkingDays: 5,
  },
  edi: {
    noContactWorkingDays: 5,
    expiryYellowCalendarDays: 60,
    expiryRedCalendarDays: 30,
    /** Not at stage 6 this close to go-live: move to fallback planning. */
    fallbackCalendarDays: 14,
  },
} as const;
