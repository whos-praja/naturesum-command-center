/**
 * Parallel-cascade runway model.
 *
 * Reflects how Naturesum actually fulfils orders:
 *
 *   - Each marketplace (Amazon FBA, Flipkart, Blinkit) holds its own
 *     stock and drains at its own velocity.
 *   - The central warehouse holds its own stock and ships direct-to-
 *     customer / B2B at its own (warehouse) velocity.
 *   - When a marketplace runs out of stock, the central warehouse picks
 *     up that marketplace's demand on top of its own (so WH velocity
 *     grows in steps as channels die).
 *   - "Total runway" for a SKU = the moment the central warehouse also
 *     hits zero, i.e. the longest channel survives until then plus the
 *     time WH alone can serve everyone.
 *
 * The Amazon channel is a special case per the founder's rule
 * (AMZ-001):
 *   - Amazon FBA fulfils BOTH Amazon orders and Shopify (D2C) orders.
 *   - When FBA hits zero, both Amazon and Shopify demand fall back to
 *     the central warehouse (Amazon via MCF, Shopify direct).
 *   - We display the Amazon channel as one combined cell with a split
 *     caption `(amz_orders) + (shopify_orders)`.
 *
 * Returns:
 *   {
 *     channels: [
 *       { key, label, stock, velocity, runway, willExhaustOnDay }
 *     ],
 *     wh: { stock, baseVelocity, runway },   // standalone-warehouse runway
 *     totalRunway,   // days until central WH hits zero, given the cascade
 *     phases,        // [ { fromDay, toDay, whVelocity }, ... ] for charting
 *   }
 *
 * Pass in:
 *   {
 *     whStock,        // central warehouse FG count
 *     whVelocity,     // warehouse's own (B2B + own-channel) velocity
 *     channels: [
 *       { key, label, stock, velocity },     // each marketplace
 *     ],
 *   }
 */
export function computeCascade({ whStock, whVelocity = 0, channels = [] }) {
  // Per-channel "own stock" runway — what the channel can sustain
  // independently before it dips into the warehouse.
  const enriched = channels.map(ch => {
    const v = Math.max(0, ch.velocity || 0);
    return {
      ...ch,
      velocity: v,
      runway: v > 0 ? ch.stock / v : Infinity,
    };
  });

  // Build the phase timeline: sort the channels by when they hit zero.
  // Phase boundaries are the days each channel dies. Between boundaries,
  // WH ships at its own velocity + the sum of dead channels' velocities.
  const events = enriched
    .filter(c => Number.isFinite(c.runway))
    .map(c => ({ day: c.runway, channel: c }))
    .sort((a, b) => a.day - b.day);

  const phases = [];
  let lastDay = 0;
  let whVelNow = whVelocity;          // grows as channels die
  let whRemaining = whStock;

  for (const ev of events) {
    const span = ev.day - lastDay;
    const consumed = whVelNow * span;
    whRemaining -= consumed;
    phases.push({ fromDay: lastDay, toDay: ev.day, whVelocity: whVelNow });

    // If WH already exhausted during this span, stop early.
    if (whRemaining <= 0) {
      const overshoot = -whRemaining;     // by how many days' worth WH went negative
      const phase = phases[phases.length - 1];
      // The actual death day = lastDay + (whStock at lastDay) / whVelNow
      const recovered = whVelNow > 0 ? (consumed + whRemaining) / whVelNow : 0;
      phase.toDay = lastDay + recovered;
      whRemaining = 0;
      lastDay = phase.toDay;
      break;
    }
    lastDay = ev.day;
    whVelNow += ev.channel.velocity;
  }

  // Final phase — all channels dead, WH ships everything until exhausted.
  if (whRemaining > 0 && whVelNow > 0) {
    const finalSpan = whRemaining / whVelNow;
    phases.push({ fromDay: lastDay, toDay: lastDay + finalSpan, whVelocity: whVelNow });
    whRemaining = 0;
    lastDay = lastDay + finalSpan;
  }

  const totalRunway = whVelNow > 0 || whVelocity > 0 ? lastDay : Infinity;

  // Standalone WH runway (the central-warehouse-only number) — useful for
  // the "what if marketplaces vanished" view in Materials breakdown.
  const standaloneWhRunway = whVelocity > 0 ? whStock / whVelocity : Infinity;

  return {
    channels: enriched.map(c => ({
      key:     c.key,
      label:   c.label,
      stock:   c.stock,
      velocity: c.velocity,
      runway:  c.runway,
      willExhaustOnDay: c.runway,
    })),
    wh: {
      stock:        whStock,
      baseVelocity: whVelocity,
      runway:       standaloneWhRunway,
    },
    totalRunway,
    phases,
  };
}

/** Format a runway in days into a short human label. */
export function fmtRunway(days) {
  if (!Number.isFinite(days)) return "∞";
  if (days < 1) return `~${Math.round(days * 24)}h`;
  if (days >= 60) return `~${(days / 30).toFixed(1)}mo`;
  return `~${Math.round(days)}d`;
}
