/** L5 is observation-led onboarding: one launch, then two automatic branches. */
export function maskGuide(state) {
  if (state.queues[0].length) return {
    title: "Новый продукт — растительная маска",
    text: "Запусти растительную основу. Центрифуга разделит её на мякоть и сок. Для одной маски понадобятся обе части.",
    suggested: "plant_base",
  };
  const spin = state.rooms.centrifuge;
  if (spin.status === "PROCESSING") return {
    title: "Из одной основы получатся два шарика",
    text: "Центрифуга разделяет основу. Состав сохранится: мякоть и сок продолжат путь отдельно.",
  };
  if (spin.status === "OUTPUT_WAIT") return {
    title: "Центрифуга выпускает части по очереди",
    text: "После первой части внутри ещё остаётся вторая. Комната освободится только после выхода обеих; занятый выход может задержать шарик.",
  };
  if (state.belt.some((c) => c.kind === "plant_mask")) return {
    title: "Маска готова — дождись доставки",
    text: "Обе части снова в одном продукте. Маску зачислят в заказ, когда она доедет до упаковки.",
  };
  if (state.rooms.mixer.status === "PROCESSING" || state.rooms.mixer.status === "OUTPUT_WAIT") return {
    title: "Две подготовленные части — одна маска",
    text: "Смеситель соединяет гель и охлаждённый экстракт. Ни одна часть основы не пропала.",
  };
  if (state.rooms.mixer.status === "COLLECTING") return {
    title: "Смеситель ждёт вторую часть",
    text: "Для маски нужны и гель, и охлаждённый экстракт. Первая часть подождёт вторую в смесителе.",
  };
  if (state.events.some((e) => e.type === "OutputReleased" && e.roomId === "centrifuge")) return {
    title: "У каждой части свой маршрут",
    text: "Мякоть отправится в нагрев, а сок — в холод. После обработки обе части нужны смесителю. Комнаты забирают их автоматически.",
  };
  return {
    title: "Основа едет к центрифуге",
    text: "Другие комнаты пока пропускают её. Сначала основу нужно разделить; больше ничего запускать не требуется.",
  };
}
