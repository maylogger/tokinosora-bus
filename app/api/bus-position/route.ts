import { NextResponse } from "next/server"

import {
  normalizePlate,
  unwrapBusA1Rows,
  type TdxBusA1Row,
} from "@/lib/tdx-bus-a1"
import {
  TRACKED_BUS_DIRECTION_DISPLAY,
  TRACKED_BUS_ROUTE_DISPLAY,
  normalizeTrackedBusPlate,
} from "@/lib/live-bus-config"
import {
  LIVE_BUS_MESSAGES,
  liveBusBeforeFirstStopMessage,
  liveBusNextStopMessage,
  type LiveBusStatusMessage,
} from "@/lib/live-bus-messages"

const TDX_BY_FREQUENCY_BASE =
  "https://tdx.transportdata.tw/api/basic/v2/Bus/RealTimeByFrequency/City"
const TDX_NEAR_STOP_BASE =
  "https://tdx.transportdata.tw/api/basic/v2/Bus/RealTimeNearStop/City"
const TDX_ESTIMATED_TIME_OF_ARRIVAL_BASE =
  "https://tdx.transportdata.tw/api/basic/v2/Bus/EstimatedTimeOfArrival/City"
const TDX_AUTH_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
const TDX_TOKEN_REFRESH_BUFFER_MS = 60_000
/** 避免本機 reload / React dev mode 短時間重複打爆 TDX 配額。 */
const TDX_RESPONSE_CACHE_TTL_MS = 15_000
/** TDX 短暫 429/5xx 時，可用最後成功資料撐過尖峰，但避免舊資料留太久。 */
const TDX_RESPONSE_STALE_TTL_MS = 120_000
const API_CACHE_CONTROL =
  "public, max-age=0, s-maxage=15, stale-while-revalidate=45"
const API_NO_STORE_CACHE_CONTROL = "no-store"

type CachedTdxToken = {
  accessToken: string
  expiresAt: number
}

type CachedTdxResponse = {
  body: unknown
  freshExpiresAt: number
  staleExpiresAt: number
}

type TdxRouteResult = {
  body: unknown
  cacheStatus: "fresh" | "stale"
}

type TdxRequestContext = {
  usedStale: boolean
}

let cachedTdxToken: CachedTdxToken | null = null
let pendingTdxToken: Promise<string> | null = null
const cachedTdxResponses = new Map<string, CachedTdxResponse>()
const pendingTdxResponses = new Map<string, Promise<TdxRouteResult>>()

type OkBody = {
  tracked: boolean
  lat?: number
  lng?: number
  plateNumb?: string
  updateTime?: string | null
  gpsTime?: string | null
  nearStop?: LiveBusNearStop | null
  statusMessage?: LiveBusStatusMessage
  statusUpdateKey?: string
  reason?: string
}

type TdxLocalized = { Zh_tw?: string; En?: string }

type TdxBusA2Row = {
  PlateNumb?: string
  RouteUID?: string
  RouteID?: string
  RouteName?: TdxLocalized
  SubRouteUID?: string
  SubRouteID?: string
  SubRouteName?: TdxLocalized
  Direction?: number
  StopSequence?: number
  StopUID?: string
  StopID?: string
  StopName?: TdxLocalized
  A2EventType?: number
  GPSTime?: string
  SrcUpdateTime?: string
  UpdateTime?: string
}

type TdxEtaRow = {
  RouteUID?: string
  RouteID?: string
  Direction?: number
  StopSequence?: number
  StopUID?: string
  StopID?: string
  StopName?: TdxLocalized
  EstimateTime?: number | null
  StopStatus?: number
  SrcUpdateTime?: string
  UpdateTime?: string
}

type LiveBusNearStop = {
  routeName: string | null
  direction: number | null
  directionDisplay: string
  stopSequence: number | null
  stopName: string | null
  updateTime: string | null
  gpsTime: string | null
}

type LiveBusStatus = {
  message: LiveBusStatusMessage
  updateKey: string
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

async function requestTdxAccessToken(
  clientId: string,
  clientSecret: string
): Promise<string> {
  const res = await fetch(TDX_AUTH_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  const text = await res.text()

  if (!res.ok) {
    throw new Error(`TDX auth: HTTP ${res.status} ${text.slice(0, 120)}`)
  }

  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch {
    throw new Error("TDX auth: 非 JSON 回應")
  }

  const data = body as Record<string, unknown>
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("TDX auth: 回應缺少 access_token")
  }

  const expiresIn = Number(data.expires_in ?? 3600)
  cachedTdxToken = {
    accessToken: data.access_token,
    expiresAt:
      Date.now() +
      Math.max(expiresIn * 1000 - TDX_TOKEN_REFRESH_BUFFER_MS, 5_000),
  }

  return data.access_token
}

async function getTdxAccessToken(): Promise<string | undefined> {
  const staticToken = readEnv("TDX_ACCESS_TOKEN")
  if (staticToken) return staticToken

  const clientId = readEnv("TDX_CLIENT_ID")
  const clientSecret = readEnv("TDX_CLIENT_SECRET")
  if (!clientId || !clientSecret) return undefined

  if (cachedTdxToken && cachedTdxToken.expiresAt > Date.now()) {
    return cachedTdxToken.accessToken
  }

  pendingTdxToken ??= requestTdxAccessToken(clientId, clientSecret)
  try {
    return await pendingTdxToken
  } finally {
    pendingTdxToken = null
  }
}

function filteredParams(plate: string): URLSearchParams {
  const filter = `PlateNumb eq '${plate.replace(/'/g, "''")}'`
  return new URLSearchParams([
    ["$format", "JSON"],
    ["$filter", filter],
  ])
}

function jsonParams(): URLSearchParams {
  return new URLSearchParams([["$format", "JSON"]])
}

function cachedJson(body: OkBody, context: TdxRequestContext) {
  const headers: Record<string, string> = {
    "Cache-Control": API_CACHE_CONTROL,
  }
  if (context.usedStale) {
    headers["X-TDX-Cache"] = "stale"
  }

  return NextResponse.json(body, { headers })
}

function errorJson(body: OkBody, status = 502) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": API_NO_STORE_CACHE_CONTROL,
    },
  })
}

async function fetchTdxRoute(
  baseUrl: string,
  apiLabel: string,
  citySegment: string,
  query: URLSearchParams,
  context: TdxRequestContext
): Promise<unknown> {
  const route = encodeURIComponent(TRACKED_BUS_ROUTE_DISPLAY)
  const url = `${baseUrl}/${citySegment}/${route}?${query.toString()}`
  const cached = cachedTdxResponses.get(url)
  if (cached && cached.freshExpiresAt > Date.now()) {
    return cached.body
  }

  const pending = pendingTdxResponses.get(url)
  if (pending) {
    const result = await pending
    if (result.cacheStatus === "stale") context.usedStale = true
    return result.body
  }

  const request = requestTdxRoute(url, apiLabel, citySegment)
  pendingTdxResponses.set(url, request)
  try {
    const result = await request
    if (result.cacheStatus === "stale") context.usedStale = true
    return result.body
  } finally {
    pendingTdxResponses.delete(url)
  }
}

async function requestTdxRoute(
  url: string,
  apiLabel: string,
  citySegment: string
): Promise<TdxRouteResult> {
  try {
    const token = await getTdxAccessToken()

    const headers: HeadersInit = {
      Accept: "application/json",
      "User-Agent": "tokinosora-bus/1.0",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }

    const res = await fetch(url, { cache: "no-store", headers })
    const text = await res.text()

    if (!res.ok) {
      throw new Error(
        `TDX ${apiLabel}/${citySegment}: HTTP ${res.status} ${text.slice(0, 120)}`
      )
    }

    const body = JSON.parse(text) as unknown
    cachedTdxResponses.set(url, {
      body,
      freshExpiresAt: Date.now() + TDX_RESPONSE_CACHE_TTL_MS,
      staleExpiresAt: Date.now() + TDX_RESPONSE_STALE_TTL_MS,
    })

    return { body, cacheStatus: "fresh" }
  } catch (error) {
    const stale = cachedTdxResponses.get(url)
    if (stale && stale.staleExpiresAt > Date.now()) {
      return { body: stale.body, cacheStatus: "stale" }
    }

    if (error instanceof SyntaxError) {
      throw new Error(`TDX ${apiLabel}/${citySegment}: 非 JSON 回應`)
    }
    throw error
  }
}

async function fetchTdxCity(
  citySegment: string,
  query: URLSearchParams,
  context: TdxRequestContext
): Promise<unknown> {
  return fetchTdxRoute(TDX_BY_FREQUENCY_BASE, "A1", citySegment, query, context)
}

async function fetchTdxEta(
  citySegment: string,
  query: URLSearchParams,
  context: TdxRequestContext
): Promise<unknown> {
  return fetchTdxRoute(
    TDX_ESTIMATED_TIME_OF_ARRIVAL_BASE,
    "ETA",
    citySegment,
    query,
    context
  )
}

function mergeBodies(results: PromiseSettledResult<unknown>[]): TdxBusA1Row[] {
  const out: TdxBusA1Row[] = []
  for (const r of results) {
    if (r.status === "fulfilled") {
      out.push(...unwrapBusA1Rows(r.value))
    }
  }
  return out
}

function unwrapBusA2Rows(body: unknown): TdxBusA2Row[] {
  if (body == null) return []
  if (Array.isArray(body)) return body as TdxBusA2Row[]

  if (typeof body === "object") {
    const obj = body as Record<string, unknown>
    const v = obj.value
    if (Array.isArray(v)) return v as TdxBusA2Row[]
    const root = obj.BusA2Data ?? obj.busA2Data
    if (Array.isArray(root)) return root as TdxBusA2Row[]
  }

  return []
}

function unwrapEtaRows(body: unknown): TdxEtaRow[] {
  if (body == null) return []
  if (Array.isArray(body)) return body as TdxEtaRow[]

  if (typeof body === "object") {
    const obj = body as Record<string, unknown>
    const v = obj.value
    if (Array.isArray(v)) return v as TdxEtaRow[]
    const root = obj.EstimatedTimeOfArrival ?? obj.estimatedTimeOfArrival
    if (Array.isArray(root)) return root as TdxEtaRow[]
  }

  return []
}

function localizedText(value: TdxLocalized | undefined): string | null {
  return value?.Zh_tw?.trim() || value?.En?.trim() || null
}

function parseTdxTime(value: string | null | undefined): number {
  if (!value) return 0

  const normalized = value.trim().replace(" ", "T")
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
  const timestamp = Date.parse(hasTimeZone ? normalized : `${normalized}+08:00`)

  return Number.isFinite(timestamp) ? timestamp : 0
}

function findNearStopByPlate(
  rows: TdxBusA2Row[],
  plateNormalized: string
): TdxBusA2Row | undefined {
  return rows
    .filter((row) => normalizePlate(row.PlateNumb ?? "") === plateNormalized)
    .sort(
      (a, b) =>
        parseTdxTime(b.GPSTime ?? b.UpdateTime ?? b.SrcUpdateTime) -
        parseTdxTime(a.GPSTime ?? a.UpdateTime ?? a.SrcUpdateTime)
    )[0]
}

function findA1ByPlate(
  rows: TdxBusA1Row[],
  plateNormalized: string
): TdxBusA1Row | undefined {
  return rows
    .filter((row) => normalizePlate(row.PlateNumb ?? "") === plateNormalized)
    .sort(
      (a, b) =>
        parseTdxTime(b.GPSTime ?? b.UpdateTime) -
        parseTdxTime(a.GPSTime ?? a.UpdateTime)
    )[0]
}

function hasBusPosition(row: TdxBusA1Row | undefined): row is TdxBusA1Row & {
  BusPosition: { PositionLat: number; PositionLon: number }
} {
  return (
    typeof row?.BusPosition?.PositionLat === "number" &&
    typeof row.BusPosition.PositionLon === "number"
  )
}

function findEtaByStop(
  rows: TdxEtaRow[],
  direction: number,
  stopSequence: number
): TdxEtaRow | undefined {
  return rows.find(
    (row) => row.Direction === direction && row.StopSequence === stopSequence
  )
}

function hasEstimateTime(row: TdxEtaRow): boolean {
  return (
    typeof row.EstimateTime === "number" && Number.isFinite(row.EstimateTime)
  )
}

function findNextEta({
  rows,
  direction,
  stopSequence,
  routeUID,
  currentStopUID,
}: {
  rows: TdxEtaRow[]
  direction: number
  stopSequence: number
  routeUID: string | undefined
  currentStopUID: string | undefined
}): TdxEtaRow | undefined {
  const bySequence = findEtaByStop(rows, direction, stopSequence)
  if (bySequence) return bySequence

  if (!routeUID) return undefined

  return rows
    .filter(
      (row) =>
        row.RouteUID === routeUID &&
        row.Direction === direction &&
        row.StopUID !== currentStopUID &&
        hasEstimateTime(row)
    )
    .sort((a, b) => Number(a.EstimateTime) - Number(b.EstimateTime))[0]
}

function estimatedMinutes(row: TdxEtaRow | undefined): number | null {
  if (row?.EstimateTime == null) return null

  return Math.ceil(row.EstimateTime / 60)
}

function statusKey(parts: (string | number | null | undefined)[]): string {
  return parts.map((part) => part ?? "").join("|")
}

function buildLiveBusStatus({
  plate,
  a1Bus,
  a2Bus,
  etaRows,
}: {
  plate: string
  a1Bus: TdxBusA1Row | undefined
  a2Bus: TdxBusA2Row | undefined
  etaRows: TdxEtaRow[]
}): LiveBusStatus {
  if (!a1Bus && !a2Bus) {
    return {
      message: LIVE_BUS_MESSAGES.notStarted(plate),
      updateKey: statusKey([plate, "not-started"]),
    }
  }

  const direction = a2Bus?.Direction ?? a1Bus?.Direction
  if (typeof direction !== "number" || !Number.isFinite(direction)) {
    return {
      message: LIVE_BUS_MESSAGES.updating,
      updateKey: statusKey([plate, "missing-direction"]),
    }
  }

  const currentStopSequence = a2Bus?.StopSequence
  const isAfterFirstStop =
    typeof currentStopSequence === "number" && currentStopSequence > 1

  if (!isAfterFirstStop) {
    const firstStopEta = findEtaByStop(etaRows, direction, 1)
    const minutes = estimatedMinutes(firstStopEta)

    if (minutes == null) {
      return {
        message: LIVE_BUS_MESSAGES.startedNoEta(plate),
        updateKey: statusKey([
          plate,
          "started-no-eta",
          direction,
          a1Bus?.GPSTime,
          a2Bus?.GPSTime,
        ]),
      }
    }

    const stopName =
      localizedText(firstStopEta?.StopName) ??
      LIVE_BUS_MESSAGES.firstStopFallbackName
    return {
      message: liveBusBeforeFirstStopMessage(plate, minutes, stopName),
      updateKey: statusKey([
        plate,
        "before-first-stop",
        direction,
        firstStopEta?.StopSequence,
        firstStopEta?.EstimateTime,
        firstStopEta?.UpdateTime,
        firstStopEta?.SrcUpdateTime,
      ]),
    }
  }

  const nextStopEta = findNextEta({
    rows: etaRows,
    direction,
    stopSequence: currentStopSequence + 1,
    routeUID: a2Bus?.RouteUID,
    currentStopUID: a2Bus?.StopUID,
  })
  const minutes = estimatedMinutes(nextStopEta)

  if (minutes == null) {
    return {
      message: LIVE_BUS_MESSAGES.updating,
      updateKey: statusKey([
        plate,
        "after-first-stop-no-eta",
        direction,
        currentStopSequence,
        a2Bus?.GPSTime,
      ]),
    }
  }

  const stopName =
    localizedText(nextStopEta?.StopName) ??
    LIVE_BUS_MESSAGES.nextStopFallbackName
  return {
    message: liveBusNextStopMessage(plate, minutes, stopName),
    updateKey: statusKey([
      plate,
      "after-first-stop",
      direction,
      nextStopEta?.StopSequence,
      nextStopEta?.EstimateTime,
      nextStopEta?.UpdateTime,
      nextStopEta?.SrcUpdateTime,
    ]),
  }
}

function directionDisplayFromSubRoute(
  subRouteName: string | null,
  routeName: string | null
): string {
  const route = routeName || TRACKED_BUS_ROUTE_DISPLAY
  const name = subRouteName?.trim()
  if (!name) return TRACKED_BUS_DIRECTION_DISPLAY

  const routeSuffix = name.startsWith(route) ? name.slice(route.length) : name
  const [from, to] = routeSuffix.split("往")

  if (from?.trim() && to?.trim()) {
    return `${from.trim()} → ${to.trim()}`
  }

  return TRACKED_BUS_DIRECTION_DISPLAY
}

async function fetchNearStop(
  plateNormalized: string,
  context: TdxRequestContext
): Promise<LiveBusNearStop | null> {
  const body = await fetchTdxRoute(
    TDX_NEAR_STOP_BASE,
    "A2",
    "Taipei",
    jsonParams(),
    context
  )
  const hit = findNearStopByPlate(unwrapBusA2Rows(body), plateNormalized)
  if (!hit) return null

  const routeName = localizedText(hit.RouteName) ?? TRACKED_BUS_ROUTE_DISPLAY
  const subRouteName = localizedText(hit.SubRouteName)

  return {
    routeName,
    direction:
      typeof hit.Direction === "number" && Number.isFinite(hit.Direction)
        ? hit.Direction
        : null,
    directionDisplay: directionDisplayFromSubRoute(subRouteName, routeName),
    stopSequence:
      typeof hit.StopSequence === "number" && Number.isFinite(hit.StopSequence)
        ? hit.StopSequence
        : null,
    stopName: localizedText(hit.StopName),
    updateTime: hit.UpdateTime ?? null,
    gpsTime: hit.GPSTime ?? hit.SrcUpdateTime ?? null,
  }
}

async function fetchNearStopRow(
  plateNormalized: string,
  context: TdxRequestContext
): Promise<TdxBusA2Row | undefined> {
  const body = await fetchTdxRoute(
    TDX_NEAR_STOP_BASE,
    "A2",
    "Taipei",
    jsonParams(),
    context
  )

  return findNearStopByPlate(unwrapBusA2Rows(body), plateNormalized)
}

async function fetchEtaRows(context: TdxRequestContext): Promise<TdxEtaRow[]> {
  const body = await fetchTdxEta("Taipei", jsonParams(), context)

  return unwrapEtaRows(body)
}

async function fetchBothMerged(
  query: URLSearchParams,
  context: TdxRequestContext
): Promise<{
  rows: TdxBusA1Row[]
  settled: [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]
}> {
  const settled = await Promise.allSettled([
    fetchTdxCity("Taipei", query, context),
    fetchTdxCity("NewTaipei", query, context),
  ])
  return { rows: mergeBodies(settled), settled }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const selectedPlate = normalizeTrackedBusPlate(url.searchParams.get("plate"))
  const plateNorm = normalizePlate(selectedPlate)
  const tdxContext: TdxRequestContext = { usedStale: false }

  try {
    if (url.searchParams.get("source") === "near-stop") {
      const nearStop = await fetchNearStop(plateNorm, tdxContext)
      const body: OkBody = nearStop
        ? {
            tracked: true,
            plateNumb: selectedPlate,
            updateTime: nearStop.updateTime,
            gpsTime: nearStop.gpsTime,
            nearStop,
          }
        : {
            tracked: false,
            nearStop: null,
            reason: `空媽公車（${selectedPlate}）未在靠站動態資料中`,
          }
      return cachedJson(body, tdxContext)
    }

    const first = await fetchBothMerged(
      filteredParams(selectedPlate),
      tdxContext
    )
    let merged = first.rows
    let a1Bus = findA1ByPlate(merged, plateNorm)

    /* 若帶 OData 請求被拒，改抓完整列表後在伺服端比車牌（流量較大，僅作備援）。 */
    const anyRejected = first.settled.some((s) => s.status === "rejected")
    if (!a1Bus && anyRejected) {
      const backup = await fetchBothMerged(
        new URLSearchParams([["$format", "JSON"]]),
        tdxContext
      )
      merged = backup.rows
      a1Bus = findA1ByPlate(merged, plateNorm)
    }

    const a2Bus = await fetchNearStopRow(plateNorm, tdxContext)
    const shouldFetchEta =
      Boolean(a1Bus || a2Bus) &&
      typeof (a2Bus?.Direction ?? a1Bus?.Direction) === "number"
    const etaRows = shouldFetchEta ? await fetchEtaRows(tdxContext) : []
    const status = buildLiveBusStatus({
      plate: selectedPlate,
      a1Bus,
      a2Bus,
      etaRows,
    })

    if (!a1Bus && !a2Bus) {
      const reasons = [...first.settled]
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) =>
          String((r.reason as Error)?.message ?? r.reason ?? "unknown")
        )
      const hasReadableA1Data = merged.length > 0 || !anyRejected

      const body: OkBody = hasReadableA1Data
        ? {
            tracked: false,
            statusMessage: status.message,
            statusUpdateKey: status.updateKey,
          }
        : {
            tracked: false,
            reason:
              reasons.join(" | ") ||
              "未取得任何縣市的 A1 JSON（可於 .env 設定 TDX_CLIENT_ID / TDX_CLIENT_SECRET）",
          }
      return hasReadableA1Data ? cachedJson(body, tdxContext) : errorJson(body)
    }

    const hit = hasBusPosition(a1Bus) ? a1Bus : undefined
    const body: OkBody = {
      tracked: true,
      lat: hit?.BusPosition.PositionLat,
      lng: hit?.BusPosition.PositionLon,
      plateNumb: a1Bus?.PlateNumb ?? a2Bus?.PlateNumb ?? selectedPlate,
      updateTime: a1Bus?.UpdateTime ?? a2Bus?.UpdateTime ?? null,
      gpsTime: a1Bus?.GPSTime ?? a2Bus?.GPSTime ?? null,
      nearStop: null,
      statusMessage: status.message,
      statusUpdateKey: status.updateKey,
    }
    return cachedJson(body, tdxContext)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const body: OkBody = { tracked: false, reason: msg }
    return errorJson(body)
  }
}
