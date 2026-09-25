import { ROOMS, STATUS, compositionOf, createOperations, validateLevel } from "./canon.mjs";

const clone = (value) => structuredClone(value);
const makeCapsule = (level, c) => ({ ...c, composition: clone(level.substances[c.kind].composition) });
const plain = ({ pos, distance, lastEventId, ...capsule }) => capsule;
const opFor = (state, room) => state.operations.find((o) => o.id === room.operationId);
const recipeFor = (state, operation) => state.level.recipes.find((r) => r.id === operation.recipeId);

function emit(state, phase, type, causeId = null, data = {}) {
  const event = { runId: state.runId, eventId: `${state.runId}:e:${++state.eventSeq}`, tick: state.tick, phase, type, causeId, ...data };
  state.events.push(event);
  return event.eventId;
}

export function createState(level, { runId = "run-1" } = {}) {
  validateLevel(level);
  if (typeof runId !== "string" || !runId) throw new Error("runId is required");
  const definition = clone(level);
  const queues = definition.queues.map((q) => q.map((c) => makeCapsule(definition, c)));
  const state = {
    version: "flow-0.2", runId, generation: 0, level: definition, tick: 0, paused: false,
    result: null, loseReason: null, queues, belt: [], buffer: Array(definition.board.bufferSlots).fill(null),
    rooms: Object.fromEntries(ROOMS.map((id) => [id, { id,
      status: definition.board.roomPorts[id].active === false ? STATUS.inactive : STATUS.empty,
      operationId: null, inputs: [], outputs: [], remainingTicks: 0, finishedTick: null,
    }])),
    operations: createOperations(definition),
    orders: definition.orders.map((o) => ({ ...o, delivered: 0, completedEventId: null })),
    delivered: [], retiredIds: [], initialComposition: compositionOf(queues.flat()),
    commandReceipts: [], eventSeq: 0, events: [],
  };
  emit(state, "P1", "LevelStarted", null, { levelId: level.id });
  assertInvariants(state);
  return state;
}

function finishRoom(state, room) {
  const op = opFor(state, room);
  const outputs = op.outputs.map((c) => makeCapsule(state.level, c));
  op.finishedEventId = emit(state, "P2", "ProcessingFinished", op.startedEventId, {
    roomId: room.id, operationId: op.id, orderId: op.orderId,
    inputIds: room.inputs.map((c) => c.id), outputIds: outputs.map((c) => c.id),
    inputComposition: compositionOf(room.inputs), outputComposition: compositionOf(outputs),
  });
  state.retiredIds.push(...room.inputs.map((c) => c.id));
  room.inputs = [];
  room.outputs = outputs;
  room.status = STATUS.output;
  room.finishedTick = state.tick;
  op.status = "FINISHED";
}

function remainingInputs(recipe, inputs) {
  const remaining = { ...recipe.inputs };
  for (const c of inputs) remaining[c.kind] = (remaining[c.kind] ?? 0) - 1;
  return remaining;
}

function acceptIngredient(state, capsule, room) {
  if (![STATUS.empty, STATUS.collecting].includes(room.status)) return;
  let operation = opFor(state, room);
  if (!operation) operation = state.operations.find((op) => op.room === room.id && op.status === "PLANNED" && (recipeFor(state, op).inputs[capsule.kind] ?? 0) > 0);
  if (!operation) return;
  const recipe = recipeFor(state, operation);
  if ((remainingInputs(recipe, room.inputs)[capsule.kind] ?? 0) <= 0) return;
  room.operationId = operation.id;
  operation.status = "ACTIVE";
  room.status = STATUS.collecting;
  state.belt = state.belt.filter((c) => c.id !== capsule.id);
  room.inputs.push(plain(capsule));
  const accepted = emit(state, "P4", "IngredientAccepted", capsule.lastEventId, { capsuleId: capsule.id, roomId: room.id, operationId: operation.id, orderId: operation.orderId });
  if (Object.values(remainingInputs(recipe, room.inputs)).every((n) => n === 0)) {
    const completed = emit(state, "P4", "RecipeCompleted", accepted, { roomId: room.id, operationId: operation.id, orderId: operation.orderId, inputIds: room.inputs.map((c) => c.id) });
    operation.startedEventId = emit(state, "P4", "ProcessingStarted", completed, { roomId: room.id, operationId: operation.id, orderId: operation.orderId, durationTicks: recipe.durationTicks });
    room.status = STATUS.processing;
    room.remainingTicks = recipe.durationTicks;
  }
}

function deliver(state, capsule) {
  const order = state.orders.find((o) => o.product === capsule.kind && o.delivered < o.batches);
  if (!order) return;
  state.belt = state.belt.filter((c) => c.id !== capsule.id);
  state.delivered.push({ capsule: plain(capsule), orderId: order.id });
  order.delivered += 1;
  const delivered = emit(state, "P4", "ProductDelivered", capsule.lastEventId, { capsuleId: capsule.id, orderId: order.id, count: order.delivered });
  if (order.delivered === order.batches) order.completedEventId = emit(state, "P4", "OrderCompleted", delivered, { orderId: order.id });
}

function entryBlockers(state, pos) {
  const reasons = [];
  if (state.belt.length >= state.level.board.beltCapacity) reasons.push("BELT_CAPACITY");
  if (state.belt.some((c) => c.pos === pos)) reasons.push("ENTRY_OCCUPIED");
  return reasons;
}

function releaseOutputs(state) {
  const board = state.level.board;
  const waiting = Object.values(state.rooms).filter((r) => r.status === STATUS.output)
    .sort((a, b) => a.finishedTick - b.finishedTick || board.outputTiePriority.indexOf(a.id) - board.outputTiePriority.indexOf(b.id));
  for (const room of waiting) {
    const op = opFor(state, room);
    const pos = board.roomPorts[room.id].output;
    const reasons = entryBlockers(state, pos).map((r) => r === "ENTRY_OCCUPIED" ? "OUTPUT_OCCUPIED" : r);
    if (reasons.length) {
      emit(state, "P5", "OutputBlocked", op.finishedEventId, { roomId: room.id, operationId: op.id, capsuleId: room.outputs[0].id, reasons, diagnostic: true });
      continue;
    }
    const capsule = room.outputs.shift();
    const released = emit(state, "P5", "OutputReleased", op.finishedEventId, { capsuleId: capsule.id, roomId: room.id, operationId: op.id, orderId: op.orderId, position: pos });
    state.belt.push({ ...capsule, pos, distance: 0, lastEventId: released });
    if (!room.outputs.length) {
      emit(state, "P5", "RoomFreed", released, { roomId: room.id, operationId: op.id });
      op.status = "RELEASED";
      Object.assign(room, { status: STATUS.empty, operationId: null, inputs: [], outputs: [], remainingTicks: 0, finishedTick: null });
    }
  }
}

function sourceFor(state, command) {
  if (command.source === "B" && Number.isInteger(command.slot) && command.slot >= 1 && command.slot <= state.buffer.length) return { capsule: state.buffer[command.slot - 1], origin: "buffer", index: command.slot - 1 };
  if (/^Q[1-3]$/.test(command.source ?? "")) {
    const index = Number(command.source.slice(1)) - 1;
    return { capsule: state.queues[index][0], origin: "queue", index };
  }
  return { capsule: null };
}

/** Read-only check of current geometry; tick rechecks after movement and outputs. */
export function previewLaunch(state, command) {
  const source = sourceFor(state, command);
  const reasons = [];
  if (state.result) reasons.push("LEVEL_ENDED");
  if (state.paused) reasons.push("PAUSED");
  if (!source.capsule || source.capsule.id !== command.capsuleId) reasons.push("SOURCE_MISMATCH");
  reasons.push(...entryBlockers(state, state.level.board.launchPosition));
  return { ok: reasons.length === 0, reasons };
}

function processCommand(state, command, phase = "P6", forcedReason = null) {
  const cmd = command && typeof command === "object" ? command : {};
  const previous = state.commandReceipts.find((r) => r.commandId === cmd.commandId);
  if (cmd.runId === state.runId && previous) {
    const eventId = emit(state, phase, "CommandIgnored", previous.eventId, { commandId: cmd.commandId, reason: "DUPLICATE_COMMAND" });
    return { commandId: cmd.commandId, ok: false, reason: "DUPLICATE_COMMAND", eventId };
  }
  const requested = emit(state, phase, "LaunchRequested", null, { commandId: cmd.commandId ?? null, capsuleId: cmd.capsuleId ?? null, source: cmd.source ?? null });
  let reason = null;
  if (cmd.runId !== state.runId) reason = "RUN_MISMATCH";
  else if (typeof cmd.commandId !== "string" || !cmd.commandId || typeof cmd.capsuleId !== "string") reason = "INVALID_COMMAND";
  else if (forcedReason) reason = forcedReason;
  else if (cmd.targetTick !== state.tick) reason = "TICK_MISMATCH";
  else reason = previewLaunch(state, cmd).reasons[0] ?? null;
  let eventId;
  if (reason) eventId = emit(state, phase, "LaunchRejected", requested, { commandId: cmd.commandId ?? null, capsuleId: cmd.capsuleId ?? null, reason });
  else {
    const source = sourceFor(state, cmd);
    const capsule = source.capsule;
    if (source.origin === "queue") state.queues[source.index].shift();
    else state.buffer[source.index] = null;
    eventId = emit(state, phase, "CapsuleLaunched", requested, { commandId: cmd.commandId, capsuleId: capsule.id, source: cmd.source, ...(source.origin === "buffer" ? { slot: cmd.slot } : {}) });
    state.belt.push({ ...capsule, pos: state.level.board.launchPosition, distance: 0, lastEventId: eventId });
    emit(state, phase, source.origin === "queue" ? "QueueAdvanced" : "BufferSlotFreed", eventId, { source: cmd.source, ...(source.origin === "queue" ? { nextCapsuleId: state.queues[source.index][0]?.id ?? null } : { slot: cmd.slot }) });
  }
  const receipt = { commandId: cmd.commandId ?? null, ok: reason === null, reason, eventId };
  if (cmd.runId === state.runId && typeof cmd.commandId === "string" && cmd.commandId) state.commandReceipts.push(receipt);
  return receipt;
}

function isStaticDeadlock(state) {
  if (state.belt.length) return false;
  if (Object.values(state.rooms).some((r) => r.status === STATUS.processing || r.status === STATUS.output)) return false;
  // With an empty belt and positive capacity, every available source can launch.
  if (state.queues.some((q) => q.length) || state.buffer.some(Boolean)) return false;
  return state.orders.some((o) => o.delivered < o.batches);
}

/** One independent clock tick. Pure: no mutation of inputs or queueing future input. */
export function tick(previous, commands = []) {
  if (!Array.isArray(commands)) throw new TypeError("commands must be an array");
  if (previous.result) return { state: previous, events: [], advanced: false, commandResults: commands.map((c) => ({ commandId: c?.commandId ?? null, ok: false, reason: "LEVEL_ENDED" })) };
  const state = clone(previous);
  const offset = state.events.length;
  if (state.paused) {
    const commandResults = commands.map((c) => processCommand(state, c, "CONTROL", "PAUSED"));
    return { state, events: state.events.slice(offset), advanced: false, commandResults };
  }
  state.tick += 1;
  const clock = emit(state, "P1", "TickStarted");
  for (const room of Object.values(state.rooms)) { // P2: only previously running batches
    if (room.status !== STATUS.processing) continue;
    room.remainingTicks -= 1;
    emit(state, "P2", "ProcessingAdvanced", clock, { roomId: room.id, operationId: room.operationId, remainingTicks: room.remainingTicks });
    if (room.remainingTicks === 0) finishRoom(state, room);
  }
  for (const c of state.belt) { // P3: simultaneous rotation
    c.pos = (c.pos + 1) % state.level.board.positions;
    c.distance += 1;
    c.lastEventId = emit(state, "P3", "CapsuleAdvanced", c.lastEventId, { capsuleId: c.id, position: c.pos, distance: c.distance });
  }
  for (const c of [...state.belt].sort((a, b) => a.pos - b.pos)) { // P4: distinct service ports
    if (c.pos === state.level.board.packingPosition) deliver(state, c);
    else {
      const id = ROOMS.find((id) => state.level.board.roomPorts[id].input === c.pos);
      if (id) acceptIngredient(state, c, state.rooms[id]);
    }
  }
  releaseOutputs(state); // P5
  const commandResults = commands.map((c) => processCommand(state, c)); // P6
  const overflows = [];
  for (const c of [...state.belt]) { // P7
    if (c.pos !== state.level.board.returnPosition || c.distance < state.level.board.returnMinDistance) continue;
    const slot = state.buffer.indexOf(null);
    if (slot < 0) overflows.push(emit(state, "P7", "ReturnOverflowDetected", c.lastEventId, { capsuleId: c.id }));
    else {
      state.belt = state.belt.filter((x) => x.id !== c.id);
      state.buffer[slot] = plain(c);
      emit(state, "P7", "CapsuleParked", c.lastEventId, { capsuleId: c.id, slot: slot + 1 });
    }
  }
  // P8: all deliveries outrank overflow; never emit both terminal outcomes.
  if (state.orders.every((o) => o.delivered === o.batches)) {
    state.result = "WIN";
    const completed = state.orders.map((o) => o.completedEventId);
    const latest = state.events.findLast((e) => completed.includes(e.eventId));
    emit(state, "P8", "LevelWon", latest.eventId, { completedOrderEventIds: completed });
  } else if (overflows.length) {
    state.result = "LOSE";
    state.loseReason = "RETURN_OVERFLOW";
    emit(state, "P8", "LevelLost", overflows[0], { reason: state.loseReason });
  } else if (isStaticDeadlock(state)) {
    const deadlock = emit(state, "P8", "DeadlockDetected", clock, { reason: "NO_SOURCE_OR_AUTOMATIC_PROGRESS" });
    state.result = "LOSE";
    state.loseReason = "STATIC_DEADLOCK";
    emit(state, "P8", "LevelLost", deadlock, { reason: state.loseReason });
  }
  assertInvariants(state);
  return { state, events: state.events.slice(offset), commandResults, advanced: true };
}

export function setPaused(previous, paused) {
  if (typeof paused !== "boolean") throw new TypeError("paused must be boolean");
  if (previous.result || previous.paused === paused) return { state: previous, events: [] };
  const state = clone(previous);
  state.paused = paused;
  const offset = state.events.length;
  emit(state, "CONTROL", paused ? "GamePaused" : "GameResumed");
  return { state, events: state.events.slice(offset) };
}

export function restart(previous) {
  const state = createState(previous.level, { runId: `${previous.runId}/restart-${previous.generation + 1}` });
  state.generation = previous.generation + 1;
  return { state, events: state.events };
}

export function liveCapsules(state) {
  return [...state.queues.flat(), ...state.belt, ...state.buffer.filter(Boolean), ...Object.values(state.rooms).flatMap((r) => [...r.inputs, ...r.outputs])];
}
export function conservedComposition(state) {
  return compositionOf([...liveCapsules(state), ...state.delivered.map((d) => d.capsule)]);
}

/** Always-on contracts identify violations at the tick that introduced them. */
export function assertInvariants(state) {
  const check = (ok, message) => { if (!ok) throw new Error(`Invariant at tick ${state.tick}: ${message}`); };
  const all = [...liveCapsules(state), ...state.delivered.map((d) => d.capsule)];
  check(new Set(all.map((c) => c.id)).size === all.length, "capsule exists in multiple places");
  check(new Set(state.retiredIds).size === state.retiredIds.length && !all.some((c) => state.retiredIds.includes(c.id)), "consumed capsule reappeared");
  check(JSON.stringify(conservedComposition(state)) === JSON.stringify(state.initialComposition), "composition changed");
  check(state.belt.length <= state.level.board.beltCapacity, "belt over capacity");
  check(state.buffer.length === state.level.board.bufferSlots, "buffer size changed");
  check(new Set(state.belt.map((c) => c.pos)).size === state.belt.length, "belt collision");
  check(state.belt.every((c) => Number.isInteger(c.pos) && c.pos >= 0 && c.pos < state.level.board.positions && Number.isInteger(c.distance) && c.distance >= 0), "invalid position or distance");
  for (const c of all) check(JSON.stringify(compositionOf([c])) === JSON.stringify(compositionOf([state.level.substances[c.kind]])), "capsule portion changed");
  for (const room of Object.values(state.rooms)) {
    if ([STATUS.empty, STATUS.inactive].includes(room.status)) check(!room.operationId && !room.inputs.length && !room.outputs.length && room.remainingTicks === 0, "empty room holds a batch");
    else {
      const op = opFor(state, room);
      check(op && op.room === room.id, "room operation mismatch");
      if (room.status === STATUS.output) check(!room.inputs.length && room.outputs.length > 0 && room.remainingTicks === 0 && op.status === "FINISHED", "invalid waiting output");
      else {
        const remaining = Object.values(remainingInputs(recipeFor(state, op), room.inputs));
        check(room.inputs.length > 0 && !room.outputs.length && remaining.every((n) => n >= 0) && op.status === "ACTIVE", "invalid recipe inputs");
        if (room.status === STATUS.processing) check(remaining.every((n) => n === 0) && room.remainingTicks > 0, "processing incomplete recipe");
        else check(room.status === STATUS.collecting && remaining.some((n) => n > 0) && room.remainingTicks === 0, "collecting full recipe");
      }
    }
  }
  for (const o of state.orders) check(o.delivered >= 0 && o.delivered <= o.batches && o.delivered === state.delivered.filter((d) => d.orderId === o.id).length, "order credited incorrectly");
  return true;
}

/** Small projection compatible with the independently reviewed design ledger. */
export function checkpoint(state) {
  return { tick: state.tick, queues: state.queues.map((q) => q.map((c) => c.id)),
    belt: [...state.belt].sort((a, b) => a.pos - b.pos).map((c) => ({ id: c.id, pos: c.pos, distance: c.distance })),
    buffer: state.buffer.map((c) => c?.id ?? null),
    rooms: Object.fromEntries(ROOMS.map((id) => {
      const r = state.rooms[id];
      return [id, { state: r.status, operation: opFor(state, r)?.batch ?? null, remainingTicks: r.remainingTicks, inputs: r.inputs.map((c) => c.id), outputs: r.outputs.map((c) => c.id) }];
    })), delivered: state.delivered.length, result: state.result };
}
