/** 未指定網址 plate query 時，即時標示之預設車號（對應 TDX BusA1Data.PlateNumb） */
export const DEFAULT_TRACKED_BUS_PLATE = "EAL-0080"

export function normalizeTrackedBusPlate(plate: string | null | undefined) {
  const normalized = plate?.trim().toUpperCase()
  return normalized || DEFAULT_TRACKED_BUS_PLATE
}

/** 路線代號（臺北市 API 之路徑參數 RouteName） */
export const TRACKED_BUS_ROUTE_DISPLAY = "307"

/** 目前地圖鎖定的 307 子路線方向 */
export const TRACKED_BUS_DIRECTION_DISPLAY = "莒光 → 板橋前站"
