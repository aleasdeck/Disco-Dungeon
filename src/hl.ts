// What the HUD points at on the board: the enemy under the cursor or finger in the queue gets a ring under its stand.

export const hl = {
  /** Index in the room's mob list, or -1. */
  mob: -1,
  /** Set by the page so a new highlight gets drawn even while nothing else moves. */
  changed: () => {},
};
