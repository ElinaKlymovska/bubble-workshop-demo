// Presentation-only motion cues for launches, returns and room intake; the engine stays authoritative.
const CUES = new Set(['CapsuleLaunched', 'CapsuleParked', 'IngredientAccepted']);

export class MotionFeed {
  constructor() {
    this.runId = null;
    this.tick = -1;
    this.seen = new Set();
  }

  /** Cue events new since the last call. Resets, history jumps and non-animated renders only mark them seen. */
  take(state, { animate = false } = {}) {
    const reset = this.runId !== state.runId || state.tick < this.tick;
    if (reset) this.seen = new Set();
    const fresh = state.events.filter((event) => CUES.has(event.type) && !this.seen.has(event.eventId));
    for (const event of fresh) this.seen.add(event.eventId);
    this.runId = state.runId;
    this.tick = state.tick;
    if (reset || !animate) return [];
    return fresh.map(({ eventId, type, capsuleId, source = null, slot = null, roomId = null }) => ({ eventId, type, capsuleId, source, slot, roomId }));
  }
}
