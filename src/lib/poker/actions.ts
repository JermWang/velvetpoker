/**
 * Server-side action validation for Texas Hold'em.
 *
 * Every action a client submits passes through `validateAction` BEFORE any state
 * mutation. The engine never trusts client-provided amounts beyond what these
 * rules allow. All amounts are bigint chip units.
 */

import type { HandState, PlayerAction, SeatState } from "./types";

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

function seatOf(state: HandState, seat: number): SeatState | undefined {
  return state.seats.find((s) => s.seat === seat);
}

/** Chips a seat needs to add to match the current bet. */
export function amountToCall(state: HandState, seat: SeatState): bigint {
  const diff = state.currentBet - seat.committedThisStreet;
  return diff > 0n ? diff : 0n;
}

/** Minimum legal "raise to" total for the current street. */
export function minRaiseTo(state: HandState): bigint {
  return state.currentBet + state.lastRaiseSize;
}

/** Minimum legal "bet" total when there is no outstanding bet. */
export function minBet(state: HandState): bigint {
  return state.bigBlind;
}

export function validateAction(
  state: HandState,
  action: PlayerAction,
): ValidationResult {
  if (state.isComplete) return { ok: false, error: "Hand is complete" };

  const seat = seatOf(state, action.seat);
  if (!seat) return { ok: false, error: "Unknown seat" };
  if (state.toActSeat !== action.seat) {
    return { ok: false, error: "Not your turn to act" };
  }
  if (!seat.inHand || seat.hasFolded) {
    return { ok: false, error: "Seat is not active in this hand" };
  }
  if (seat.isAllIn || seat.stack === 0n) {
    return { ok: false, error: "Seat is already all-in" };
  }

  const toCall = amountToCall(state, seat);

  switch (action.type) {
    case "FOLD":
      return { ok: true };

    case "CHECK":
      if (toCall > 0n) {
        return { ok: false, error: "Cannot check facing a bet" };
      }
      return { ok: true };

    case "CALL":
      if (toCall === 0n) {
        return { ok: false, error: "Nothing to call; check instead" };
      }
      return { ok: true };

    case "ALL_IN":
      return { ok: true };

    case "BET": {
      if (state.currentBet > 0n) {
        return { ok: false, error: "Facing a bet; raise instead of bet" };
      }
      if (action.amount === undefined) {
        return { ok: false, error: "Bet requires an amount" };
      }
      const target = action.amount;
      const maxTarget = seat.committedThisStreet + seat.stack;
      if (target <= 0n) return { ok: false, error: "Bet must be positive" };
      if (target > maxTarget) {
        return { ok: false, error: "Bet exceeds stack" };
      }
      // Allow a sub-minimum bet only if it is the player's entire stack.
      if (target < minBet(state) && target !== maxTarget) {
        return { ok: false, error: `Minimum bet is ${minBet(state)}` };
      }
      return { ok: true };
    }

    case "RAISE": {
      if (state.currentBet === 0n) {
        return { ok: false, error: "No bet to raise; bet instead" };
      }
      // Betting wasn't reopened to this player: they already acted on this
      // level and only face a short (sub-minimum) all-in increment. They may
      // call or fold, but not re-raise. (A full raise resets hasActedThisStreet,
      // re-granting raise rights.)
      if (seat.hasActedThisStreet) {
        return {
          ok: false,
          error: "Betting wasn't reopened — you can only call or fold",
        };
      }
      if (action.amount === undefined) {
        return { ok: false, error: "Raise requires an amount" };
      }
      const target = action.amount;
      const maxTarget = seat.committedThisStreet + seat.stack;
      if (target <= state.currentBet) {
        return { ok: false, error: "Raise must exceed current bet" };
      }
      if (target > maxTarget) {
        return { ok: false, error: "Raise exceeds stack" };
      }
      // Allow a sub-minimum raise only if it is an all-in.
      if (target < minRaiseTo(state) && target !== maxTarget) {
        return {
          ok: false,
          error: `Minimum raise is to ${minRaiseTo(state)}`,
        };
      }
      return { ok: true };
    }

    default:
      return { ok: false, error: "Unsupported action" };
  }
}
