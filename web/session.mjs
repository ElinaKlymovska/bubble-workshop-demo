import { createState, tick, setPaused } from "../sim/engine.mjs";
import { levelFromFixtures } from "../sim/level-data.mjs";
import { withCampaign } from "../sim/campaign-data.mjs";

/** UI scheduling only. All game rules and outcomes remain in the tested engine. */
export class Session {
  constructor(fixtures) {
    this.fixtures = withCampaign(fixtures);
    this.generation = 0;
    this.serial = 0;
    this.reset();
  }
  reset({ level = this.levelId ?? "L1", scenario = null } = {}) {
    const script = scenario ? this.fixtures.scenarios.find((s) => s.id === scenario) : null;
    if (scenario && !script) throw new Error(`Unknown scenario: ${scenario}`);
    this.levelId = script?.level ?? level;
    this.scenario = script;
    this.state = createState(levelFromFixtures(this.fixtures, this.levelId), { runId: `browser-${++this.generation}` });
    this.playing = false;
    this.ready = true;
    this.pending = [];
    this.frames = [this.state];
    this.viewIndex = 0;
    this.lastResult = null;
  }
  get reviewing() { return this.viewIndex !== this.frames.length - 1; }
  get view() { return this.reviewing ? this.frames[this.viewIndex] : this.state; }
  start() {
    if (this.state.result || this.reviewing) return false;
    this.state = setPaused(this.state, false).state;
    this.playing = true;
    this.ready = false;
    return true;
  }
  pause() {
    this.playing = false;
    this.ready = false;
    this.state = setPaused(this.state, true).state;
    if (this.pending.length) this.state = tick(this.state, this.pending).state;
    this.pending = [];
  }
  enqueue(source, capsuleId, slot) {
    if (this.scenario || this.reviewing || this.state.result || this.state.paused) return false;
    // A click before the first tick starts the workshop. Paused input never does.
    if (this.ready) this.start();
    if (this.pending.some((c) => c.capsuleId === capsuleId)) return false;
    this.pending.push({ runId: this.state.runId, commandId: `click-${++this.serial}`,
      targetTick: this.state.tick + 1, source, capsuleId, ...(slot ? { slot } : {}) });
    return true;
  }
  advance() {
    if (!this.playing || this.reviewing || this.state.result) return null;
    const commands = this.scenario
      ? this.scenario.commands.filter((c) => c.targetTick === this.state.tick + 1).map((c) => ({ ...c, runId: this.state.runId }))
      : this.pending;
    this.pending = [];
    const result = tick(this.state, commands);
    this.state = result.state;
    this.lastResult = result;
    this.frames.push(this.state);
    if (this.frames.length > 160) this.frames.shift();
    this.viewIndex = this.frames.length - 1;
    if (this.state.result) this.playing = false;
    return result;
  }
  step() {
    if (this.reviewing || this.state.result) return null;
    this.start();
    const result = this.advance();
    this.pause();
    return result;
  }
  seek(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.frames.length) return;
    this.pause();
    this.viewIndex = index;
  }
  live() { this.viewIndex = this.frames.length - 1; }
  finishDemo() {
    if (!this.scenario || this.reviewing) return;
    this.start();
    let remaining = 200;
    while (this.playing && remaining-- > 0) this.advance();
    if (!this.state.result) this.pause();
  }
}
