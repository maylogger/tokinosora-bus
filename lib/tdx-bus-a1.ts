/** TDX 公車動態定時資料 A1（JSON）最低限度欄位 */

export type TdxBusA1Row = {
  PlateNumb?: string
  BusPosition?: {
    PositionLat?: number
    PositionLon?: number
  }
  UpdateTime?: string
  GPSTime?: string
}

/** 將 TDX OData／陣列等回應整理成車輛列 */
export function unwrapBusA1Rows(body: unknown): TdxBusA1Row[] {
  if (body == null) return []
  if (Array.isArray(body)) return body as TdxBusA1Row[]

  if (typeof body === "object") {
    const obj = body as Record<string, unknown>
    const v = obj.value
    if (Array.isArray(v)) return v as TdxBusA1Row[]
    const root = obj.BusA1Data ?? obj.busA1Data
    if (Array.isArray(root)) return root as TdxBusA1Row[]
  }

  return []
}

export function normalizePlate(plate: string): string {
  return plate.trim().toUpperCase()
}

export function findBusByPlate(
  rows: TdxBusA1Row[],
  plateNormalized: string,
): TdxBusA1Row | undefined {
  return rows.find(
    (row) =>
      normalizePlate(row.PlateNumb ?? "") === plateNormalized &&
      typeof row.BusPosition?.PositionLat === "number" &&
      typeof row.BusPosition?.PositionLon === "number",
  )
}
