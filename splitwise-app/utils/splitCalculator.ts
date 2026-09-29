/**
 * Deterministic Split Calculator Utility for SplitWise.
 * Mirrors backend SplitCalculationService logic using integer cents
 * to guarantee no money is lost or created due to rounding.
 */

export interface ParticipantBreakdown {
  userId: string;
  name?: string;
  paidAmount: number;
  shareAmount: number;
  netAmount: number; // positive = gets back / receivable, negative = owes
  profilePictureUrl?: string;
}

export interface BillBreakdown {
  totalAmount: number;
  paidBy: string;
  participantCount: number;
  participants: ParticipantBreakdown[];
}

export interface ItemToSplit {
  name?: string;
  price: number;
  sharedByUserIds: string[];
  customShares?: Record<string, number>;
}

/**
 * Splits an amount equally among participants using deterministic integer cents.
 * Any remainder cents are assigned first to the payer (if present), then to other
 * participants in stable sorted order.
 */
export function splitEquallyDeterministically(
  totalAmount: number,
  participantIds: string[],
  payerId?: string
): Record<string, number> {
  const uniqueParticipants = Array.from(new Set(participantIds.filter(Boolean)));
  const result: Record<string, number> = {};

  if (uniqueParticipants.length === 0 || totalAmount <= 0) {
    return result;
  }

  const totalCents = Math.round(totalAmount * 100);
  const n = uniqueParticipants.length;
  const baseCents = Math.floor(totalCents / n);
  let remainderCents = totalCents % n;

  // Initialize all with base cents
  for (const uid of uniqueParticipants) {
    result[uid] = baseCents;
  }

  // Stable ordering for remainder cents
  const sortedParticipants = [...uniqueParticipants].sort((a, b) => a.localeCompare(b));

  // Payer gets first remainder cent if present
  if (payerId && remainderCents > 0 && uniqueParticipants.includes(payerId)) {
    result[payerId] += 1;
    remainderCents--;
  }

  // Allocate remaining remainder cents to other participants in sorted order
  for (const uid of sortedParticipants) {
    if (remainderCents <= 0) break;
    if (uid !== payerId) {
      result[uid] += 1;
      remainderCents--;
    }
  }

  // Convert cents back to decimal currency
  const shares: Record<string, number> = {};
  for (const uid of uniqueParticipants) {
    shares[uid] = Math.round(result[uid]) / 100;
  }

  return shares;
}

/**
 * Calculates per-person shares across all bill items.
 * Handles custom shares if specified on an item, otherwise splits equally deterministically.
 */
export function calculateItemShares(
  items: ItemToSplit[],
  payerId?: string
): Record<string, number> {
  const accumulatedCents: Record<string, number> = {};

  for (const item of items) {
    if (!item.price || item.price <= 0) continue;

    const uniqueParticipants = Array.from(new Set(item.sharedByUserIds.filter(Boolean)));
    if (uniqueParticipants.length === 0) continue;

    if (item.customShares && Object.keys(item.customShares).length > 0) {
      // Use custom shares
      for (const [uid, amount] of Object.entries(item.customShares)) {
        if (amount && amount > 0) {
          const cents = Math.round(amount * 100);
          accumulatedCents[uid] = (accumulatedCents[uid] || 0) + cents;
        }
      }
    } else {
      // Equal split for this item
      const itemShares = splitEquallyDeterministically(item.price, uniqueParticipants, payerId);
      for (const [uid, amount] of Object.entries(itemShares)) {
        const cents = Math.round(amount * 100);
        accumulatedCents[uid] = (accumulatedCents[uid] || 0) + cents;
      }
    }
  }

  const result: Record<string, number> = {};
  for (const [uid, cents] of Object.entries(accumulatedCents)) {
    result[uid] = Math.round(cents) / 100;
  }

  return result;
}

/**
 * Calculates complete bill breakdown with Total, Paid by, Participants count,
 * and each person's Paid, Share, and Net amount (+/-).
 */
export function calculateBillBreakdown(
  totalAmount: number,
  paidBy: string,
  participantIds: string[],
  items?: ItemToSplit[],
  customShares?: Record<string, number>
): BillBreakdown {
  const allParticipantIds = Array.from(
    new Set([paidBy, ...participantIds].filter(Boolean))
  );

  let shares: Record<string, number> = {};

  if (customShares && Object.keys(customShares).length > 0) {
    shares = customShares;
  } else if (items && items.length > 0) {
    shares = calculateItemShares(items, paidBy);
  } else {
    shares = splitEquallyDeterministically(totalAmount, allParticipantIds, paidBy);
  }

  // Ensure all participants have an entry even if 0
  for (const uid of allParticipantIds) {
    if (shares[uid] === undefined) {
      shares[uid] = 0;
    }
  }

  const participants: ParticipantBreakdown[] = allParticipantIds.map(uid => {
    const paidAmount = uid === paidBy ? totalAmount : 0;
    const shareAmount = shares[uid] || 0;
    const netAmount = Math.round((paidAmount - shareAmount) * 100) / 100;

    return {
      userId: uid,
      paidAmount,
      shareAmount,
      netAmount,
    };
  });

  return {
    totalAmount,
    paidBy,
    participantCount: allParticipantIds.length,
    participants,
  };
}

/**
 * Validates custom shares against the expected total.
 * Returns whether shares sum to total within 0.01 precision and without negative shares.
 */
export function validateCustomShares(
  shares: Record<string, number>,
  expectedTotal: number
): { isValid: boolean; sum: number; difference: number; message?: string } {
  let sum = 0;
  for (const [uid, amount] of Object.entries(shares)) {
    if (amount < 0) {
      return {
        isValid: false,
        sum: 0,
        difference: 0,
        message: 'Shares cannot be negative',
      };
    }
    sum += amount;
  }

  sum = Math.round(sum * 100) / 100;
  const expected = Math.round(expectedTotal * 100) / 100;
  const diff = Math.round((expected - sum) * 100) / 100;

  if (Math.abs(diff) > 0.01) {
    return {
      isValid: false,
      sum,
      difference: diff,
      message: diff > 0
        ? `Remaining to allocate: ₹${diff.toFixed(2)}`
        : `Exceeds bill total by ₹${Math.abs(diff).toFixed(2)}`,
    };
  }

  return {
    isValid: true,
    sum,
    difference: 0,
  };
}
