/** Proposed game recipe for the first centrifuge lesson; no engine rule changes. */
export function maskLevel(board) {
  const definition = {
    id: "L5", board: structuredClone(board),
    substances: {
      plant_base: { composition: { juice: 1, pulp: 1 } },
      plant_juice: { composition: { juice: 1 } },
      plant_pulp: { composition: { pulp: 1 } },
      cooled_juice: { composition: { juice: 1 } },
      soft_pulp: { composition: { pulp: 1 } },
      plant_mask: { composition: { juice: 1, pulp: 1 } },
    },
    queues: [[{ id: "P1", kind: "plant_base" }], [], []],
    recipes: [
      { id: "split", room: "centrifuge", inputs: { plant_base: 1 }, outputs: [
        { kind: "plant_pulp", idPrefix: "F" }, { kind: "plant_juice", idPrefix: "J" },
      ], durationTicks: 3 },
      { id: "heat", room: "heater", inputs: { plant_pulp: 1 }, outputs: [{ kind: "soft_pulp", idPrefix: "S" }], durationTicks: 2 },
      { id: "cool", room: "cold", inputs: { plant_juice: 1 }, outputs: [{ kind: "cooled_juice", idPrefix: "K" }], durationTicks: 2 },
      { id: "mix", room: "mixer", inputs: { soft_pulp: 1, cooled_juice: 1 }, outputs: [{ kind: "plant_mask", idPrefix: "A" }], durationTicks: 3 },
    ],
    orders: [{ id: "mask", product: "plant_mask", batches: 1, recipeIds: ["split", "heat", "cool", "mix"] }],
  };
  definition.board.roomPorts.centrifuge.active = true;
  return definition;
}
