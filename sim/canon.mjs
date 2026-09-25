/** Flow contract 0.2. A kind includes material state and its indivisible portion. */
export const ROOMS = ["mixer", "heater", "cold", "centrifuge"];
export const STATUS = Object.freeze({ empty: "EMPTY", collecting: "COLLECTING", processing: "PROCESSING", output: "OUTPUT_WAIT", inactive: "INACTIVE" });

const positive = (n) => Number.isSafeInteger(n) && n > 0;
const named = (s) => typeof s === "string" && s.length > 0;
function requireThat(ok, message) { if (!ok) throw new Error(`Invalid level: ${message}`); }

export function compositionOf(capsules) {
  const result = {};
  for (const c of capsules) for (const [material, n] of Object.entries(c.composition)) result[material] = (result[material] ?? 0) + n;
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

/** Visible order priority, then batch, then recipe order. Output IDs are reserved. */
export function createOperations(level) {
  const prefixes = new Map();
  const recipes = new Map(level.recipes.map((r) => [r.id, r]));
  return level.orders.flatMap((order) => Array.from({ length: order.batches }, (_, i) =>
    order.recipeIds.map((recipeId) => {
      const recipe = recipes.get(recipeId);
      const id = `${order.id}:${i + 1}:${recipeId}`;
      return { id, orderId: order.id, batch: i + 1, recipeId, room: recipe.room,
        status: "PLANNED", startedEventId: null, finishedEventId: null,
        outputs: recipe.outputs.map((output, index) => {
          let outputId = `${id}:out:${index + 1}`;
          if (output.idPrefix) {
            const n = (prefixes.get(output.idPrefix) ?? 0) + 1;
            prefixes.set(output.idPrefix, n);
            outputId = `${output.idPrefix}${n}`;
          }
          return { id: outputId, kind: output.kind };
        }),
      };
    }),
  ).flat());
}

export function validateLevel(level) {
  requireThat(level && typeof level === "object", "definition required");
  requireThat(named(level.id), "id required");
  const b = level.board;
  requireThat(b && positive(b.positions), "positive route length required");
  requireThat(positive(b.beltCapacity) && b.beltCapacity <= b.positions, "invalid belt capacity");
  requireThat(positive(b.bufferSlots), "positive buffer size required");
  requireThat(b.returnMinDistance === b.positions, "return needs one full revolution");
  requireThat(b.roomPorts && ROOMS.every((r) => Object.hasOwn(b.roomPorts, r)), "all four room ports required");
  const ports = [b.launchPosition, b.returnPosition, b.packingPosition];
  for (const id of ROOMS) {
    requireThat(b.roomPorts[id] && typeof b.roomPorts[id] === "object", "invalid room ports");
    ports.push(b.roomPorts[id].input, b.roomPorts[id].output);
  }
  requireThat(ports.every((p) => Number.isInteger(p) && p >= 0 && p < b.positions), "port outside route");
  requireThat(new Set(ports).size === ports.length, "ports must be distinct");
  requireThat(Array.isArray(b.outputTiePriority) && b.outputTiePriority.length === ROOMS.length && ROOMS.every((r) => b.outputTiePriority.includes(r)), "output priority must list each room once");
  requireThat(level.substances && Object.keys(level.substances).length > 0, "substances required");
  for (const [kind, substance] of Object.entries(level.substances)) {
    const comp = substance?.composition;
    requireThat(named(kind) && comp && Object.keys(comp).length > 0 && Object.values(comp).every(positive), `invalid composition of ${kind}`);
  }
  const exists = (kind) => named(kind) && Object.hasOwn(level.substances, kind);
  requireThat(Array.isArray(level.queues) && level.queues.length === 3 && level.queues.every(Array.isArray), "three queues required");
  const ids = new Set();
  for (const c of level.queues.flat()) {
    requireThat(c && named(c.id) && exists(c.kind) && !ids.has(c.id), "invalid or duplicate capsule");
    ids.add(c.id);
  }
  requireThat(Array.isArray(level.recipes), "recipes required");
  const recipeIds = new Set();
  for (const r of level.recipes) {
    requireThat(named(r.id) && !recipeIds.has(r.id), "duplicate or missing recipe id");
    recipeIds.add(r.id);
    requireThat(ROOMS.includes(r.room) && b.roomPorts[r.room].active !== false, "recipe room must be active");
    requireThat(positive(r.durationTicks), "processing duration must be positive integer");
    requireThat(r.inputs && Object.keys(r.inputs).length > 0 && Object.entries(r.inputs).every(([k, n]) => exists(k) && positive(n)), "invalid recipe inputs");
    requireThat(Array.isArray(r.outputs) && r.outputs.length > 0 && r.outputs.every((o) => o && exists(o.kind) && (o.idPrefix === undefined || named(o.idPrefix))), "invalid recipe outputs");
    const inputCount = Object.values(r.inputs).reduce((a, n) => a + n, 0);
    requireThat(r.outputs.length === (r.room === "centrifuge" ? 2 : 1) && (r.room === "mixer" ? inputCount >= 2 : inputCount === 1), `wrong input/output shape for ${r.room}`);
    const inputs = Object.entries(r.inputs).flatMap(([kind, n]) => Array(n).fill(level.substances[kind]));
    const outputs = r.outputs.map((o) => level.substances[o.kind]);
    requireThat(JSON.stringify(compositionOf(inputs)) === JSON.stringify(compositionOf(outputs)), `recipe ${r.id} does not conserve composition`);
  }
  requireThat(Array.isArray(level.orders) && level.orders.length > 0, "orders required");
  const orderIds = new Set();
  for (const order of level.orders) {
    requireThat(named(order.id) && !orderIds.has(order.id) && exists(order.product) && positive(order.batches), "invalid or duplicate order");
    orderIds.add(order.id);
    requireThat(Array.isArray(order.recipeIds) && new Set(order.recipeIds).size === order.recipeIds.length && order.recipeIds.every((id) => recipeIds.has(id)), "invalid order recipes");
  }
  const operationIds = new Set();
  for (const op of createOperations(level)) {
    requireThat(!operationIds.has(op.id), "operation id collision");
    operationIds.add(op.id);
    for (const output of op.outputs) {
      requireThat(!ids.has(output.id), `output id collision: ${output.id}`);
      ids.add(output.id);
    }
  }
  return level;
}
