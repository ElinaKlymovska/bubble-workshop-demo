/** Demo campaign. The reviewed flow-contract fixtures remain unchanged. */
import { maskLevel } from "./mask-level.mjs";
export const CAMPAIGN = [
  { id: "L1", title: "Первая баночка", goal: "Сделай первую баночку", demo: "A_L1_win" },
  { id: "L2", title: "Пока смешивается", goal: "Подготовь вторую порцию, пока первая в работе", demo: "D_L2_pipeline" },
  { id: "L3", title: "Воск в глубине", goal: "Доберись до воска и верни масло из буфера", demo: "E_L3_buffer" },
  { id: "L4", title: "Место для возврата", goal: "Выполни заказ, оставляя место для возвратов", demo: "F_L4_reserve" },
  { id: "L5", title: "Одна основа — две части", goal: "Сделай маску: используй обе части основы", demo: "G_L5_split" },
];

export function nextCampaignLevel(id) {
  const index = CAMPAIGN.findIndex((level) => level.id === id);
  return index < 0 ? null : CAMPAIGN[index + 1]?.id ?? null;
}

const creamLevel = (batches, queues) => ({ order: { id: "cream", product: "cream", batches }, queues });
const scenario = (id, level, terminalTick, rows, result = "WIN") => ({
  id, level, expected: { result, terminalTick },
  commands: rows.map(([targetTick, source, capsuleId, slot]) => ({
    commandId: `${id}-${targetTick}`, targetTick, source, capsuleId, ...(slot ? { slot } : {}),
  })),
});

const scenarios = [
  scenario("G_L5_split", "L5", 52, [[1, "Q1", "P1"]]),
  scenario("D_L2_pipeline", "L2", 42, [
    [1, "Q1", "X1"], [2, "Q2", "O1"], [3, "Q3", "W1"],
    [10, "Q1", "X2"], [24, "Q2", "O2"], [25, "Q3", "W2"],
  ]),
  scenario("E_L3_buffer", "L3", 44, [
    [1, "Q1", "O1"], [2, "Q1", "O2"], [3, "Q1", "X1"], [4, "Q2", "W1"],
    [12, "Q1", "X2"], [26, "B", "O2", 1], [27, "Q3", "W2"],
  ]),
  scenario("F_L4_reserve", "L4", 77, [
    [1, "Q3", "X3"], [2, "Q1", "O1"], [3, "Q2", "W1"],
    [10, "Q3", "X4"], [24, "Q1", "O2"], [25, "Q2", "W2"],
    [34, "Q1", "O3"], [35, "Q1", "O4"], [36, "Q1", "X1"],
    [37, "Q2", "W3"], [38, "Q2", "W4"], [45, "Q2", "X2"],
    [60, "B", "O4", 1], [61, "B", "W4", 2],
  ]),
  // Player-facing overflow demo (the reviewed C_J1_overflow stays the engine contract): every queue is spent,
  // the buffer is full and the belt holds all six balls, so the returning water has nowhere to go.
  scenario("H_J1_overflow", "J1", 40, [
    [1, "Q1", "O1"], [3, "Q1", "O2"], [5, "Q1", "O3"], [7, "Q2", "W1"], [9, "Q2", "W2"],
    [11, "Q3", "X3"], [13, "Q1", "O4"], [16, "Q1", "X1"], [18, "Q2", "W3"], [23, "Q2", "W4"],
    [28, "Q3", "X4"], [32, "B", "W2", 3], [37, "Q2", "X2"],
  ], "LOSE"),
];

/** Pure, idempotent extension usable by both the CLI and browser Session. */
export function withCampaign(fixtures) {
  const data = structuredClone(fixtures);
  data.levels.L2 = creamLevel(2, [["X1", "X2"], ["O1", "O2"], ["W1", "W2"]]);
  data.levels.L3 = creamLevel(2, [["O1", "O2", "X1", "X2"], ["W1"], ["W2"]]);
  data.levels.L4 = structuredClone(data.levels.J1);
  data.levels.L5 = { definition: maskLevel(data.board) };
  data.scenarios = data.scenarios.filter((s) => !scenarios.some((extra) => extra.id === s.id));
  data.scenarios.push(...structuredClone(scenarios));
  return data;
}
