import { NextResponse } from "next/server"

import {
  getBusDisplayName,
  getI18nDictionary,
  getLocaleFromHeaders,
  normalizeLocale,
  type Locale,
} from "@/lib/i18n"
import {
  TRACKED_BUS_ROUTE_DISPLAY,
  normalizePlate,
  normalizeTrackedBusPlate,
} from "@/lib/live-bus-config"
import {
  getLiveBusMessages,
  liveBusBeforeFirstStopMessage,
  liveBusDepartedStopMessage,
  liveBusNextStopMessage,
  liveBusSegmentStatusMessage,
  type LiveBusStatusMessage,
} from "@/lib/live-bus-messages"
import {
  buildLiveBusDataAge,
  getSegmentFromA2,
  type LiveBusDataAge,
  type LiveBusSegment,
} from "@/lib/live-bus-segment"

export const dynamic = "force-dynamic"
export const revalidate = 0

const TDX_NEAR_STOP_BASE =
  "https://tdx.transportdata.tw/api/basic/v2/Bus/RealTimeNearStop/City"
const TDX_ESTIMATED_TIME_OF_ARRIVAL_BASE =
  "https://tdx.transportdata.tw/api/basic/v2/Bus/EstimatedTimeOfArrival/City"
const TDX_STOP_OF_ROUTE_BASE =
  "https://tdx.transportdata.tw/api/basic/v2/Bus/StopOfRoute/City"
const TDX_AUTH_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
const TDX_TOKEN_REFRESH_BUFFER_MS = 60_000
/** 避免本機 reload / React dev mode 短時間重複打爆 TDX 配額。 */
const TDX_RESPONSE_CACHE_TTL_MS = 10_000
/** 臺北市 A2 約 5 秒延遲，A2 cache 太長會遮蔽前端 10 秒輪詢。 */
const TDX_A2_RESPONSE_CACHE_TTL_MS = 5_000
/** TDX 短暫 429/5xx 時，可用最後成功資料撐過尖峰，但避免舊資料留太久。 */
const TDX_RESPONSE_STALE_TTL_MS = 120_000
const API_NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  Expires: "0",
  Pragma: "no-cache",
  "Vercel-CDN-Cache-Control": "no-store",
}

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
  plateNumb?: string
  subRouteUID?: string | null
  direction?: number | null
  updateTime?: string | null
  gpsTime?: string | null
  nearStop?: LiveBusNearStop | null
  segment?: LiveBusSegment | null
  dataAge?: LiveBusDataAge | null
  nextStopEstimate?: LiveBusNextStopEstimate | null
  statusMessage?: LiveBusStatusMessage
  statusUpdateKey?: string
  reason?: string
}

type TdxLocalized = { Ja?: string; Zh_tw?: string; En?: string }

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
  DutyStatus?: number | null
  BusStatus?: number | null
  A2EventType?: number
  GPSTime?: string
  SrcUpdateTime?: string
  UpdateTime?: string
}

type TdxEtaRow = {
  PlateNumb?: string
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

type TdxRouteStop = {
  StopUID?: string
  StopID?: string
  StopName?: TdxLocalized
  StopSequence?: number
}

type TdxStopOfRouteRow = {
  RouteUID?: string
  RouteID?: string
  SubRouteUID?: string
  SubRouteID?: string
  Direction?: number
  Stops?: TdxRouteStop[]
}

type LiveBusNearStop = {
  subRouteUID: string | null
  routeName: string | null
  direction: number | null
  directionDisplay: string
  stopSequence: number | null
  stopName: string | null
  dutyStatus: number | null
  busStatus: number | null
  a2EventType: number | null
  updateTime: string | null
  srcUpdateTime: string | null
  gpsTime: string | null
}

type LiveBusNextStopEstimate = {
  stopSequence: number | null
  stopUID: string | null
  stopName: string | null
  estimateTime: number | null
  updateTime: string | null
  srcUpdateTime: string | null
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

function liveBusJson(body: OkBody, context: TdxRequestContext) {
  const headers: Record<string, string> = {
    ...API_NO_STORE_HEADERS,
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
      ...API_NO_STORE_HEADERS,
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
    const freshTtl =
      apiLabel === "A2"
        ? TDX_A2_RESPONSE_CACHE_TTL_MS
        : TDX_RESPONSE_CACHE_TTL_MS
    cachedTdxResponses.set(url, {
      body,
      freshExpiresAt: Date.now() + freshTtl,
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

async function fetchTdxStopOfRoute(
  citySegment: string,
  query: URLSearchParams,
  context: TdxRequestContext
): Promise<unknown> {
  return fetchTdxRoute(
    TDX_STOP_OF_ROUTE_BASE,
    "StopOfRoute",
    citySegment,
    query,
    context
  )
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

function unwrapStopOfRouteRows(body: unknown): TdxStopOfRouteRow[] {
  if (body == null) return []
  if (Array.isArray(body)) return body as TdxStopOfRouteRow[]

  if (typeof body === "object") {
    const obj = body as Record<string, unknown>
    const v = obj.value
    if (Array.isArray(v)) return v as TdxStopOfRouteRow[]
    const root = obj.StopOfRoute ?? obj.stopOfRoute
    if (Array.isArray(root)) return root as TdxStopOfRouteRow[]
  }

  return []
}

function localizedText(
  value: TdxLocalized | undefined,
  locale: Locale
): string | null {
  if (locale === "en") {
    return (
      value?.En?.trim() || value?.Zh_tw?.trim() || value?.Ja?.trim() || null
    )
  }

  if (locale === "ja") {
    return (
      value?.Ja?.trim() || value?.Zh_tw?.trim() || value?.En?.trim() || null
    )
  }

  return value?.Zh_tw?.trim() || value?.En?.trim() || value?.Ja?.trim() || null
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

  const candidates = rows
    .filter(
      (row) =>
        row.RouteUID === routeUID &&
        row.Direction === direction &&
        row.StopUID !== currentStopUID &&
        hasEstimateTime(row)
    )
    .sort((a, b) => Number(a.EstimateTime) - Number(b.EstimateTime))

  const futureSequenceCandidate = candidates.find(
    (row) =>
      typeof row.StopSequence === "number" && row.StopSequence >= stopSequence
  )
  if (futureSequenceCandidate) return futureSequenceCandidate

  return candidates.find((row) => typeof row.StopSequence !== "number")
}

function estimatedMinutes(row: TdxEtaRow | undefined): number | null {
  if (row?.EstimateTime == null) return null

  return Math.ceil(row.EstimateTime / 60)
}

function liveBusNextStopEstimateFromRow(
  row: TdxEtaRow | undefined,
  locale: Locale
): LiveBusNextStopEstimate | null {
  if (!row || !hasEstimateTime(row)) return null

  return {
    stopSequence:
      typeof row.StopSequence === "number" && Number.isFinite(row.StopSequence)
        ? row.StopSequence
        : null,
    stopUID: row.StopUID ?? null,
    stopName: localizedText(row.StopName, locale),
    estimateTime: row.EstimateTime ?? null,
    updateTime: row.UpdateTime ?? null,
    srcUpdateTime: row.SrcUpdateTime ?? null,
  }
}

function etaTargetStopSequence(
  a2Bus: TdxBusA2Row | undefined,
  segment: LiveBusSegment | null
): number {
  if (segment) return segment.toSequence

  const currentStopSequence = a2Bus?.StopSequence
  if (
    typeof currentStopSequence !== "number" ||
    !Number.isFinite(currentStopSequence)
  ) {
    return 1
  }

  return a2Bus?.A2EventType === 0
    ? currentStopSequence + 1
    : Math.max(currentStopSequence, 1)
}

function findNextStopEtaForBus(
  a2Bus: TdxBusA2Row | undefined,
  etaRows: TdxEtaRow[],
  direction: number,
  segment: LiveBusSegment | null
): TdxEtaRow | undefined {
  const stopSequence = etaTargetStopSequence(a2Bus, segment)

  return findNextEta({
    rows: etaRows,
    direction,
    stopSequence,
    routeUID: a2Bus?.RouteUID,
    currentStopUID: undefined,
  })
}

function filterEtaRowsByPlate(
  rows: TdxEtaRow[],
  plateNormalized: string
): TdxEtaRow[] {
  return rows.filter(
    (row) => normalizePlate(row.PlateNumb ?? "") === plateNormalized
  )
}

function findMatchingStopRoute(
  rows: TdxStopOfRouteRow[],
  a2Bus: TdxBusA2Row | undefined,
  direction: number
): TdxStopOfRouteRow | undefined {
  return (
    rows.find(
      (row) =>
        row.SubRouteUID === a2Bus?.SubRouteUID && row.Direction === direction
    ) ??
    rows.find(
      (row) => row.RouteUID === a2Bus?.RouteUID && row.Direction === direction
    )
  )
}

function stopMatchesEta(
  stop: TdxRouteStop,
  eta: TdxEtaRow,
  locale: Locale
): boolean {
  return (
    stop.StopUID === eta.StopUID ||
    stop.StopID === eta.StopID ||
    localizedText(stop.StopName, locale) === localizedText(eta.StopName, locale)
  )
}

function addRouteStopSequences(
  rows: TdxEtaRow[],
  stopRoute: TdxStopOfRouteRow | undefined,
  locale: Locale
): TdxEtaRow[] {
  const stops = stopRoute?.Stops
  if (!stops?.length) return rows

  return rows.map((row) => {
    const stop = stops.find((candidate) =>
      stopMatchesEta(candidate, row, locale)
    )
    return typeof stop?.StopSequence === "number"
      ? { ...row, StopSequence: stop.StopSequence }
      : row
  })
}

function statusKey(parts: (string | number | null | undefined)[]): string {
  return parts.map((part) => part ?? "").join("|")
}

function buildA2DepartedFallbackStatus(
  locale: Locale,
  plate: string,
  a2Bus: TdxBusA2Row | undefined,
  reason: string
): LiveBusStatus | null {
  const stopName = localizedText(a2Bus?.StopName, locale)
  if (!a2Bus || !stopName) return null

  return {
    message: liveBusDepartedStopMessage(locale, plate, stopName),
    updateKey: statusKey([
      plate,
      reason,
      a2Bus.Direction,
      a2Bus.StopSequence,
      a2Bus.StopUID,
      a2Bus.GPSTime,
      a2Bus.UpdateTime,
      a2Bus.SrcUpdateTime,
    ]),
  }
}

function buildLiveBusStatus({
  locale,
  plate,
  a2Bus,
  etaRows,
  segment,
  dataAge,
}: {
  locale: Locale
  plate: string
  a2Bus: TdxBusA2Row | undefined
  etaRows: TdxEtaRow[]
  segment: LiveBusSegment | null
  dataAge: LiveBusDataAge | null
}): LiveBusStatus {
  const liveBusMessages = getLiveBusMessages(locale)

  if (!a2Bus) {
    return {
      message: liveBusMessages.notStarted(plate),
      updateKey: statusKey([plate, "not-started"]),
    }
  }

  const direction = a2Bus.Direction
  if (typeof direction !== "number" || !Number.isFinite(direction)) {
    return {
      message: liveBusMessages.updating,
      updateKey: statusKey([plate, "missing-direction"]),
    }
  }

  if (a2Bus.BusStatus === 99 || a2Bus.DutyStatus === 2) {
    return {
      message: liveBusMessages.notInService(plate),
      updateKey: statusKey([
        plate,
        "not-in-service",
        direction,
        a2Bus.BusStatus,
        a2Bus.DutyStatus,
        a2Bus.GPSTime,
      ]),
    }
  }

  if (dataAge && !dataAge.isFresh) {
    return {
      message: liveBusMessages.dataPaused(plate),
      updateKey: statusKey([
        plate,
        "data-paused",
        direction,
        a2Bus.StopSequence,
        a2Bus.A2EventType,
        dataAge.gpsAgeSeconds,
      ]),
    }
  }

  const nextStopEta = findNextStopEtaForBus(a2Bus, etaRows, direction, segment)
  const minutes = estimatedMinutes(nextStopEta)

  if (segment?.eventType === 1) {
    return {
      message: liveBusSegmentStatusMessage(locale, plate, segment.label),
      updateKey: statusKey([
        plate,
        "a2-segment",
        direction,
        segment.eventType,
        segment.anchorSequence,
        segment.fromSequence,
        segment.toSequence,
        a2Bus.GPSTime,
      ]),
    }
  }

  if (segment?.eventType === 0) {
    if (minutes != null) {
      const stopName =
        localizedText(nextStopEta?.StopName, locale) ??
        liveBusMessages.nextStopFallbackName
      return {
        message: liveBusNextStopMessage(locale, plate, minutes, stopName),
        updateKey: statusKey([
          plate,
          "departed-next-stop-eta",
          direction,
          segment.anchorSequence,
          segment.toSequence,
          nextStopEta?.StopSequence,
          nextStopEta?.EstimateTime,
          nextStopEta?.UpdateTime,
          nextStopEta?.SrcUpdateTime,
        ]),
      }
    }

    return {
      message: liveBusSegmentStatusMessage(locale, plate, segment.label),
      updateKey: statusKey([
        plate,
        "departed-no-eta",
        direction,
        segment.anchorSequence,
        segment.fromSequence,
        segment.toSequence,
        a2Bus.GPSTime,
      ]),
    }
  }

  const currentStopSequence = a2Bus?.StopSequence
  const isAfterFirstStop =
    typeof currentStopSequence === "number" && currentStopSequence > 1

  if (!isAfterFirstStop) {
    const firstStopEta = findEtaByStop(etaRows, direction, 1)
    const minutes = estimatedMinutes(firstStopEta)

    if (minutes == null) {
      const a2Fallback = buildA2DepartedFallbackStatus(
        locale,
        plate,
        a2Bus,
        "started-no-eta-a2-fallback"
      )
      if (a2Fallback) return a2Fallback

      return {
        message: liveBusMessages.startedNoEta(plate),
        updateKey: statusKey([
          plate,
          "started-no-eta",
          direction,
          a2Bus?.GPSTime,
        ]),
      }
    }

    const stopName =
      localizedText(firstStopEta?.StopName, locale) ??
      liveBusMessages.firstStopFallbackName
    return {
      message: liveBusBeforeFirstStopMessage(locale, plate, minutes, stopName),
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

  if (minutes == null) {
    const a2Fallback = buildA2DepartedFallbackStatus(
      locale,
      plate,
      a2Bus,
      "after-first-stop-no-vehicle-eta-a2-fallback"
    )
    if (a2Fallback) return a2Fallback

    return {
      message: liveBusMessages.startedNoEta(plate),
      updateKey: statusKey([
        plate,
        "after-first-stop-no-vehicle-eta",
        direction,
        currentStopSequence,
      ]),
    }
  }

  const stopName =
    localizedText(nextStopEta?.StopName, locale) ??
    liveBusMessages.nextStopFallbackName
  return {
    message: liveBusNextStopMessage(locale, plate, minutes, stopName),
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
  locale: Locale,
  subRouteName: string | null,
  routeName: string | null
): string {
  const routeDirectionDisplay = getI18nDictionary(locale).route.directionDisplay
  const route = routeName || TRACKED_BUS_ROUTE_DISPLAY
  const name = subRouteName?.trim()
  if (!name) return routeDirectionDisplay

  const routeSuffix = name.startsWith(route) ? name.slice(route.length) : name
  const [from, to] = routeSuffix.split("往")

  if (from?.trim() && to?.trim()) {
    return `${from.trim()} → ${to.trim()}`
  }

  return routeDirectionDisplay
}

function liveBusNearStopFromRow(
  hit: TdxBusA2Row,
  locale: Locale
): LiveBusNearStop {
  const routeName =
    localizedText(hit.RouteName, locale) ?? TRACKED_BUS_ROUTE_DISPLAY
  const subRouteName = localizedText(hit.SubRouteName, locale)

  return {
    subRouteUID: hit.SubRouteUID ?? null,
    routeName,
    direction:
      typeof hit.Direction === "number" && Number.isFinite(hit.Direction)
        ? hit.Direction
        : null,
    directionDisplay: directionDisplayFromSubRoute(
      locale,
      subRouteName,
      routeName
    ),
    stopSequence:
      typeof hit.StopSequence === "number" && Number.isFinite(hit.StopSequence)
        ? hit.StopSequence
        : null,
    stopName: localizedText(hit.StopName, locale),
    dutyStatus:
      typeof hit.DutyStatus === "number" && Number.isFinite(hit.DutyStatus)
        ? hit.DutyStatus
        : null,
    busStatus:
      typeof hit.BusStatus === "number" && Number.isFinite(hit.BusStatus)
        ? hit.BusStatus
        : null,
    a2EventType:
      typeof hit.A2EventType === "number" && Number.isFinite(hit.A2EventType)
        ? hit.A2EventType
        : null,
    updateTime: hit.UpdateTime ?? null,
    srcUpdateTime: hit.SrcUpdateTime ?? null,
    gpsTime: hit.GPSTime ?? null,
  }
}

async function fetchNearStop(
  plateNormalized: string,
  context: TdxRequestContext,
  locale: Locale
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

  return liveBusNearStopFromRow(hit, locale)
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

async function fetchEtaRows(
  locale: Locale,
  plate: string,
  plateNormalized: string,
  a2Bus: TdxBusA2Row | undefined,
  direction: number,
  context: TdxRequestContext
): Promise<TdxEtaRow[]> {
  try {
    const body = await fetchTdxEta("Taipei", filteredParams(plate), context)
    const rawRows = unwrapEtaRows(body)
    const filteredRows = filterEtaRowsByPlate(rawRows, plateNormalized)

    if (rawRows.length === 0 || filteredRows.length === 0) {
      const fullBody = await fetchTdxEta("Taipei", jsonParams(), context)
      const fullRows = unwrapEtaRows(fullBody)
      const stopOfRouteBody = await fetchTdxStopOfRoute(
        "Taipei",
        jsonParams(),
        context
      )
      const stopOfRouteRows = unwrapStopOfRouteRows(stopOfRouteBody)
      const matchingStopRoute = findMatchingStopRoute(
        stopOfRouteRows,
        a2Bus,
        direction
      )
      const etaRowsWithSequences = addRouteStopSequences(
        fullRows.filter(
          (row) =>
            row.RouteUID === a2Bus?.RouteUID && row.Direction === direction
        ),
        matchingStopRoute,
        locale
      )

      return etaRowsWithSequences
    }

    return filteredRows
  } catch {
    const body = await fetchTdxEta("Taipei", jsonParams(), context)

    return filterEtaRowsByPlate(unwrapEtaRows(body), plateNormalized)
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const locale =
    normalizeLocale(url.searchParams.get("locale")) ??
    getLocaleFromHeaders(request.headers)
  const requestedPlate = url.searchParams.get("plate")?.trim() || null
  const selectedPlate = normalizeTrackedBusPlate(requestedPlate)
  const displayPlate = requestedPlate
    ? selectedPlate
    : getBusDisplayName(locale, selectedPlate)
  const plateNorm = normalizePlate(selectedPlate)
  const tdxContext: TdxRequestContext = { usedStale: false }

  try {
    if (url.searchParams.get("source") === "near-stop") {
      const nearStop = await fetchNearStop(plateNorm, tdxContext, locale)
      const body: OkBody = nearStop
        ? {
            tracked: true,
            plateNumb: selectedPlate,
            subRouteUID: nearStop.subRouteUID,
            direction: nearStop.direction,
            updateTime: nearStop.updateTime,
            gpsTime: nearStop.gpsTime,
            nearStop,
            segment: null,
            dataAge: null,
          }
        : {
            tracked: false,
            nearStop: null,
            segment: null,
            dataAge: null,
            reason: getI18nDictionary(locale).liveBus.nearStopNotFoundReason(
              getBusDisplayName(locale),
              selectedPlate
            ),
          }
      return liveBusJson(body, tdxContext)
    }

    const a2Bus = await fetchNearStopRow(plateNorm, tdxContext)
    const shouldFetchEta =
      Boolean(a2Bus) && typeof a2Bus?.Direction === "number"
    const etaRows = shouldFetchEta
      ? await fetchEtaRows(
          locale,
          selectedPlate,
          plateNorm,
          a2Bus,
          a2Bus?.Direction ?? 0,
          tdxContext
        )
      : []
    const segment = a2Bus
      ? getSegmentFromA2(
          {
            stopSequence: a2Bus.StopSequence,
            stopName: localizedText(a2Bus.StopName, locale),
            a2EventType: a2Bus.A2EventType,
          },
          undefined,
          locale
        )
      : null
    const dataAge = a2Bus
      ? buildLiveBusDataAge({
          gpsTime: a2Bus.GPSTime ?? null,
          srcUpdateTime: a2Bus.SrcUpdateTime ?? null,
          updateTime: a2Bus.UpdateTime ?? null,
        })
      : null
    const status = buildLiveBusStatus({
      locale,
      plate: displayPlate,
      a2Bus,
      etaRows,
      segment,
      dataAge,
    })

    if (!a2Bus) {
      return liveBusJson(
        {
          tracked: false,
          statusMessage: status.message,
          statusUpdateKey: status.updateKey,
        },
        tdxContext
      )
    }

    const direction = a2Bus.Direction
    const body: OkBody = {
      tracked: true,
      plateNumb: a2Bus.PlateNumb ?? selectedPlate,
      subRouteUID: a2Bus?.SubRouteUID ?? null,
      direction:
        typeof direction === "number" && Number.isFinite(direction)
          ? direction
          : null,
      updateTime: a2Bus?.UpdateTime ?? null,
      gpsTime: a2Bus?.GPSTime ?? null,
      nearStop: a2Bus ? liveBusNearStopFromRow(a2Bus, locale) : null,
      segment,
      dataAge,
      nextStopEstimate: liveBusNextStopEstimateFromRow(
        typeof direction === "number" && Number.isFinite(direction)
          ? findNextStopEtaForBus(a2Bus, etaRows, direction, segment)
          : undefined,
        locale
      ),
      statusMessage: status.message,
      statusUpdateKey: status.updateKey,
    }
    return liveBusJson(body, tdxContext)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const body: OkBody = { tracked: false, reason: msg }
    return errorJson(body)
  }
}
