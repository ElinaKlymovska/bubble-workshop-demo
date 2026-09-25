import { CAMPAIGN } from "../sim/campaign-data.mjs";

/** Explanations follow live room state; no timing script drives manual play. */
export function campaignGuide(state) {
  const level = CAMPAIGN.find((l) => l.id === state.level.id);
  const mixer = state.rooms.mixer;
  const accepting = ["EMPTY", "COLLECTING"].includes(mixer.status);
  const missing = (kind) => ["oil", "water", "wax_liquid"].includes(kind) && accepting && !mixer.inputs.some((c) => c.kind === kind);
  const inTransit = (kind) => state.belt.some((c) => c.kind === kind);
  const waxAvailable = state.queues.some((q) => q[0]?.kind === "wax_solid");
  const canHeat = state.rooms.heater.status === "EMPTY" && !inTransit("wax_solid");
  const bufferedWax = state.buffer.find((c) => c?.kind === "wax_solid");
  if (bufferedWax && canHeat) return {
    title: "Нагрев готов к воску из буфера",
    text: "Воск вернулся, пока нагрев был занят. Теперь нажми на него в буфере: он снова поедет к нагреву.",
    bufferId: bufferedWax.id,
  };
  const buffered = state.buffer.find((c) => c && missing(c.kind) && !inTransit(c.kind));
  if (buffered) return {
    title: "Верни ингредиент из буфера",
    text: "Смеситель снова может принять этот ингредиент. Нажми на него в буфере — освободишь место для следующего возврата.",
    bufferId: buffered.id,
  };
  if (waxAvailable && canHeat) return {
    title: state.level.id === "L2" && state.tick > 0 ? "Нагрев готов к следующей порции" : "Сначала подготовь воск",
    text: "Если нагрев свободен, можно плавить следующий воск, пока первая порция ещё в работе. Масло и воду подавай, когда смеситель сможет их принять.",
    suggested: "wax_solid",
  };
  if (state.level.id === "L3" && state.queues[0][0]?.kind === "oil") return {
    title: "Воск спрятан за маслом",
    text: "Запусти обе порции масла из первой очереди, чтобы открыть воск. Смеситель возьмёт одну; вторая вернётся в буфер и понадобится позже.",
    suggested: "oil",
  };
  for (const [kind, name] of [["oil", "масло"], ["water", "воду"]]) {
    if (missing(kind) && !inTransit(kind) && state.queues.some((q) => q[0]?.kind === kind)) return {
      title: `Смеситель ждёт ${name}`,
      text: `Подай одну порцию. Следующая ${kind === "oil" ? "порция масла" : "вода"} нужна уже для другой баночки — её можно пока оставить в очереди.`,
      suggested: kind,
    };
  }
  // Wax buried in a queue: release what is in front while the buffer can hold whatever the mixer declines.
  const needsWax = missing("wax_liquid") && !inTransit("wax_liquid") && !state.buffer.some((c) => c?.kind === "wax_liquid") && state.rooms.heater.status === "EMPTY";
  const dig = !waxAvailable && canHeat && needsWax && state.queues.filter((q) => q.some((c) => c.kind === "wax_solid"))
    .map((q) => q.slice(0, q.findIndex((c) => c.kind === "wax_solid"))).sort((a, b) => a.length - b.length)[0];
  if (dig) {
    const returning = state.belt.filter((c) => ["oil", "water"].includes(c.kind) && !missing(c.kind)).length;
    const spare = state.buffer.filter((c) => !c).length - returning;
    if (dig.filter((c) => !missing(c.kind)).length <= spare) return {
      title: "Открой воск в глубине очереди",
      text: `Воск лежит за ${dig[0].kind === "oil" ? "маслом" : "водой"}. Запусти ${dig[0].kind === "oil" ? "масло" : "воду"}: если смеситель его сейчас не возьмёт, шарик подождёт в буфере, а воск откроется.`,
      suggested: dig[0].kind,
    };
  }
  if (state.level.id === "L4" && !waxAvailable && state.queues.some((q) => q.some((c) => c.kind === "wax_solid"))) return {
    title: "Открывай глубину очередей постепенно",
    text: "Следующий воск скрыт за маслом и водой. Выпускай их по мере готовности смесителя и оставляй место в буфере для тех, что вернутся.",
  };
  if (state.buffer.some(Boolean)) return {
    title: "Дождись готовности нужной комнаты",
    text: "Ингредиенты в буфере сохранены. Когда нужная комната освободится, верни порцию. Слишком ранний запуск отправит её на ещё один круг.",
  };
  return { title: level?.title ?? "Следи за потоком", text: "Комнаты продолжают работу. Смотри, чего ждёт смеситель; доставка готового крема произойдёт автоматически." };
}
