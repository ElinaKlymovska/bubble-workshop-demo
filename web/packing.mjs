// Presentation-only delivery playback; simulation counts and events stay authoritative.
export class PackingPlayback {
  constructor() {
    this.runId = null;
    this.tick = -1;
    this.seen = new Set();
    this.active = [];
  }

  sync(state, { animate = false, instant = false, now = 0, speed = 1 } = {}) {
    const events = state.events.filter((event) => event.type === 'ProductDelivered');
    const fresh = events.filter((event) => !this.seen.has(event.eventId));
    const reset = this.runId !== state.runId || state.tick < this.tick;
    if (reset || instant || (!animate && fresh.length)) {
      this.active = [];
      this.seen = new Set(events.map((event) => event.eventId));
    } else {
      for (const event of fresh) {
        this.seen.add(event.eventId);
        const delivery = state.delivered.find((item) => item.capsule.id === event.capsuleId);
        if (!delivery) continue;
        this.active.push({ ...event, product: delivery.capsule.kind, start: now,
          duration: Math.min(600, 720 / speed) });
      }
    }
    this.runId = state.runId;
    this.tick = state.tick;
    this.advance(now);
  }

  advance(now) {
    this.active = this.active.filter((item) => now - item.start < item.duration);
  }

  view(state, now) {
    const motions = this.active.map((item) => ({ ...item,
      progress: Math.max(0, Math.min(1, (now - item.start) / item.duration)) }));
    const arriving = motions.filter((item) => item.progress < .7);
    return {
      motions,
      count: state.orders[0].delivered - arriving.filter((item) => item.orderId === state.orders[0].id).length,
      closed: motions.some((item) => item.progress >= .7) || (!motions.length && state.result === 'WIN'),
      credited: motions.some((item) => item.progress >= .7),
      pending: motions.length > 0,
    };
  }
}
