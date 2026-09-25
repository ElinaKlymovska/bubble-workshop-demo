/** Environment-independent adapter shared by the browser and command-line runner. */
export function levelFromFixtures(fixtures, id = "L1") {
  const source = fixtures.levels[id];
  if (!source) throw new Error(`Unknown level: ${id}`);
  if (source.definition) return structuredClone({ ...source.definition, id });
  const prefix = { heater: "H", mixer: "M", cold: "C" };
  return structuredClone({ id, board: fixtures.board, substances: fixtures.substances,
    queues: source.queues.map((q) => q.map((id) => ({ id, kind: fixtures.capsulePrefixes[id[0]] }))),
    recipes: fixtures.recipes.map((r) => ({ id: r.room, room: r.room, inputs: r.inputs,
      outputs: [{ kind: r.output, idPrefix: prefix[r.room] }], durationTicks: r.durationTicks })),
    orders: [{ ...source.order, recipeIds: fixtures.recipes.map((r) => r.room) }],
  });
}
