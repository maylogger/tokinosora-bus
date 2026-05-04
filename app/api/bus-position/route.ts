import { NextResponse } from "next/server"

import {
  findBusByPlate,
  normalizePlate,
  unwrapBusA1Rows,
  type TdxBusA1Row,
} from "@/lib/tdx-bus-a1"
import {
  TRACKED_BUS_PLATE,
  TRACKED_BUS_ROUTE_DISPLAY,
} from "@/lib/live-bus-config"

const TDX_BASE =
  "https://tdx.transportdata.tw/api/basic/v2/Bus/RealTimeByFrequency/City"

type OkBody =
  | {
      tracked: true
      lat: number
      lng: number
      plateNumb: string
      updateTime: string | null
      gpsTime: string | null
    }
  | { tracked: false; reason?: string }

function filteredParams(): URLSearchParams {
  const filter = `PlateNumb eq '${TRACKED_BUS_PLATE.replace(/'/g, "''")}'`
  return new URLSearchParams([
    ["$format", "JSON"],
    ["$filter", filter],
  ])
}

async function fetchTdxCity(
  citySegment: string,
  query: URLSearchParams,
): Promise<unknown> {
  const route = encodeURIComponent(TRACKED_BUS_ROUTE_DISPLAY)
  const url = `${TDX_BASE}/${citySegment}/${route}?${query.toString()}`

  const headers: HeadersInit = {
    Accept: "application/json",
    "User-Agent": "tokinosora-bus/1.0",
    ...(process.env.TDX_ACCESS_TOKEN
      ? { Authorization: `Bearer ${process.env.TDX_ACCESS_TOKEN}` }
      : {}),
  }

  const res = await fetch(url, { cache: "no-store", headers })
  const text = await res.text()

  if (!res.ok) {
    throw new Error(`TDX ${citySegment}: HTTP ${res.status} ${text.slice(0, 120)}`)
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`TDX ${citySegment}: 非 JSON 回應`)
  }
}

function mergeBodies(
  results: PromiseSettledResult<unknown>[],
): TdxBusA1Row[] {
  const out: TdxBusA1Row[] = []
  for (const r of results) {
    if (r.status === "fulfilled") {
      out.push(...unwrapBusA1Rows(r.value))
    }
  }
  return out
}

async function fetchBothMerged(query: URLSearchParams): Promise<{
  rows: TdxBusA1Row[]
  settled: [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]
}> {
  const settled = await Promise.allSettled([
    fetchTdxCity("Taipei", query),
    fetchTdxCity("NewTaipei", query),
  ])
  return { rows: mergeBodies(settled), settled }
}

export async function GET() {
  const plateNorm = normalizePlate(TRACKED_BUS_PLATE)

  try {
    const first = await fetchBothMerged(filteredParams())
    let merged = first.rows
    let hit = findBusByPlate(merged, plateNorm)

    /* 若帶 OData 請求被拒，改抓完整列表後在伺服端比車牌（流量較大，僅作備援）。 */
    const anyRejected = first.settled.some((s) => s.status === "rejected")
    if (!hit && anyRejected) {
      const backup = await fetchBothMerged(
        new URLSearchParams([["$format", "JSON"]]),
      )
      merged = backup.rows
      hit = findBusByPlate(merged, plateNorm)
    }

    if (!hit) {
      const reasons = [...first.settled]
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) =>
          String((r.reason as Error)?.message ?? r.reason ?? "unknown"),
        )

      const body: OkBody =
        merged.length > 0 || !anyRejected
          ? {
              tracked: false,
              reason: `車牌 ${TRACKED_BUS_PLATE} 本時段未在即時資料列中`,
            }
          : {
              tracked: false,
              reason:
                reasons.join(" | ") ||
                "未取得任何縣市的 A1 JSON（可於 .env 設定 TDX_ACCESS_TOKEN Bearer）",
            }
      return NextResponse.json(body)
    }

    const body: OkBody = {
      tracked: true,
      lat: hit.BusPosition!.PositionLat!,
      lng: hit.BusPosition!.PositionLon!,
      plateNumb: hit.PlateNumb ?? TRACKED_BUS_PLATE,
      updateTime: hit.UpdateTime ?? null,
      gpsTime: hit.GPSTime ?? null,
    }
    return NextResponse.json(body)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const body: OkBody = { tracked: false, reason: msg }
    return NextResponse.json(body, { status: 502 })
  }
}
