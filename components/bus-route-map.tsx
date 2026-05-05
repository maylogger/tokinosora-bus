"use client"

import {
  APIProvider,
  ColorScheme,
  Map,
  Marker,
  Polyline,
  useMap,
} from "@vis.gl/react-google-maps"
import { useTheme } from "next-themes"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"

import { TimedToastContent } from "@/components/timed-toast-content"
import routePaths from "@/data/bus-route-paths.json"
import { cleanMapStyles } from "@/lib/clean-map-styles"
import { darkMapStyles } from "@/lib/dark-map-styles"
import { normalizeTrackedBusPlate } from "@/lib/live-bus-config"
import {
  LIVE_BUS_MESSAGES,
  type LiveBusStatusMessage,
} from "@/lib/live-bus-messages"

type BusRoutePathEntry = {
  subRouteUID: string
  routeNameZh: string
  nameZh: string
  path: google.maps.LatLngLiteral[]
}

const routes = routePaths.routes as BusRoutePathEntry[]

/** 專案寫死顯示此子路線；若需更換請改此常數或調整 data */
const FIXED_SUB_ROUTE_UID = "TPE157462"

const fixedRoute =
  routes.find((r) => r.subRouteUID === FIXED_SUB_ROUTE_UID) ?? routes[0]
const path = fixedRoute?.path ?? []

const defaultCenter: google.maps.LatLngLiteral = {
  lat: 25.045,
  lng: 121.52,
}

/** fitBounds 四邊留白（手機／桌機共用同一組數值） */
const ROUTE_VIEW_PADDING: google.maps.Padding = {
  top: 4,
  bottom: 4,
  left: 4,
  right: 4,
}

/** 與 Sonner toast id 前綴對應，讓不同時間點的訊息保留成歷史紀錄 */
const LIVE_BUS_STATUS_TOAST_ID_PREFIX = "live-bus-status"
const LIVE_BUS_API_READ_PROBLEM_TOAST_ID_PREFIX = "live-bus-api-read-problem"

/** 淺色主題路線與車標強調色 */
const ROUTE_ACCENT_LIGHT = "#ff8ab5"
/** 深色主題路線與車標強調色 */
const ROUTE_ACCENT_DARK = "#db2777"

/** 將視窗縮放至包住整條路線 */
function FitRouteBounds({ path }: { path: google.maps.LatLngLiteral[] }) {
  const map = useMap()

  useEffect(() => {
    if (!map || path.length === 0) return

    const fit = () => {
      const bounds = new google.maps.LatLngBounds()
      for (const p of path) bounds.extend(p)
      map.fitBounds(bounds, ROUTE_VIEW_PADDING)
    }

    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [map, path])

  return null
}

/** TDX A1 資料約每分鐘更新一次 */
const LIVE_BUS_DATA_INTERVAL_MS = 60_000
/** TDX 資料理論更新後，延後幾秒再抓，避開剛更新完成前的舊資料 */
const LIVE_BUS_REFRESH_OFFSET_MS = 5_000
/** 若抓到同一筆 TDX 時間戳，縮短補抓間隔以等待下一筆資料出現 */
const LIVE_BUS_STALE_RETRY_MS = 12_000
/** 沒有時間戳或暫時抓不到車時，維持較保守的重試間隔 */
const LIVE_BUS_FALLBACK_RETRY_MS = 60_000
/** 分散多個 client 的輪詢時間，避免同秒形成尖峰。 */
const LIVE_BUS_POLL_JITTER_MS = 5_000
/** 每次取得新車位後，marker 滑動到新座標的時間 */
const LIVE_BUS_MOVE_ANIMATION_MS = 2_000
const LIVE_BUS_MARKER_BASE_SCALE = 1 / 3
/** zoom 12 以上才開始放大，避免路線全景時 marker 太搶眼 */
const LIVE_BUS_MARKER_SCALE_START_ZOOM = 12
const LIVE_BUS_MARKER_ZOOM_SCALE_STEP = 0.16
const LIVE_BUS_MARKER_MAX_SCALE_MULTIPLIER = 1.75
const LIVE_BUS_MARKER_ORIGINAL_SIZE = {
  width: 120,
  height: 102,
}
const LIVE_BUS_MARKER_ORIGINAL_ANCHOR = {
  x: 56,
  y: 80,
}
const LIVE_BUS_ROUTE_SNAP_MAX_DISTANCE_METERS = 150
const EARTH_RADIUS_METERS = 6_371_000
const DEGREES_TO_RADIANS = Math.PI / 180
const RADIANS_TO_DEGREES = 180 / Math.PI

type LiveBusPositionResponse = {
  tracked?: boolean
  lat?: number
  lng?: number
  nearStop?: {
    subRouteUID?: string | null
  } | null
  updateTime?: string | null
  gpsTime?: string | null
  statusMessage?: LiveBusStatusMessage
  statusUpdateKey?: string
  reason?: string
}

type LiveTrackedBusState = {
  plate: string
  position: google.maps.LatLngLiteral | null
  subRouteUID: string | null
  statusMessage: LiveBusStatusMessage | null
  statusTimestamp: number | null
  statusToastId: string | null
}

type ProjectedPoint = {
  x: number
  y: number
}

let liveBusToastIdSequence = 0

function parseTdxTimestamp(value: string | null | undefined): number | null {
  if (!value) return null

  const normalized = value.trim().replace(" ", "T")
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
  const timestamp = Date.parse(hasTimeZone ? normalized : `${normalized}+08:00`)

  return Number.isFinite(timestamp) ? timestamp : null
}

function liveBusToastId(prefix: string): string {
  liveBusToastIdSequence =
    (liveBusToastIdSequence + 1) % Number.MAX_SAFE_INTEGER
  return `${prefix}-${Date.now()}-${liveBusToastIdSequence}`
}

function normalizeLiveBusStatusMessage(
  message: LiveBusStatusMessage | undefined
): LiveBusStatusMessage | null {
  if (!message) return null

  if (typeof message === "string") {
    return message.trim() || null
  }

  const text = message.text.trim()
  const emoji = message.emoji.trim()

  if (!text) return null

  return { text, emoji }
}

function renderLiveBusStatusMessage(message: LiveBusStatusMessage): ReactNode {
  if (typeof message === "string") return message

  return (
    <>
      {message.text} <span className="inline-block">{message.emoji}</span>
    </>
  )
}

function toastLiveBusMessage(message: LiveBusStatusMessage, idPrefix: string) {
  toast(
    <TimedToastContent
      sentence={renderLiveBusStatusMessage(message)}
      timestamp={Date.now()}
    />,
    {
      id: liveBusToastId(idPrefix),
      duration: Number.POSITIVE_INFINITY,
      icon: null,
    }
  )
}

function nextLiveBusDelay(
  dataTimestamp: number | null,
  isFresh: boolean
): number {
  if (!dataTimestamp) return LIVE_BUS_FALLBACK_RETRY_MS
  if (!isFresh) return LIVE_BUS_STALE_RETRY_MS

  const nextExpectedUpdate =
    dataTimestamp + LIVE_BUS_DATA_INTERVAL_MS + LIVE_BUS_REFRESH_OFFSET_MS

  return Math.max(nextExpectedUpdate - Date.now(), LIVE_BUS_STALE_RETRY_MS)
}

function addLiveBusPollJitter(delay: number): number {
  return delay + Math.floor(Math.random() * LIVE_BUS_POLL_JITTER_MS)
}

function useLiveTrackedBus(plate: string) {
  const [state, setState] = useState<LiveTrackedBusState>({
    plate,
    position: null,
    subRouteUID: null,
    statusMessage: null,
    statusTimestamp: null,
    statusToastId: null,
  })
  const visibleState =
    state.plate === plate
      ? state
      : {
          plate,
          position: null,
          subRouteUID: null,
          statusMessage: null,
          statusTimestamp: null,
          statusToastId: null,
        }

  useEffect(() => {
    let stopped = false
    let timeoutId: number | undefined
    let lastDataTimestamp: number | null = null

    function scheduleNextLoad(delay: number) {
      timeoutId = window.setTimeout(
        () => void load(),
        addLiveBusPollJitter(delay)
      )
    }

    async function load() {
      let nextDelay = LIVE_BUS_FALLBACK_RETRY_MS

      try {
        const query = new URLSearchParams({ plate })
        const res = await fetch(`/api/bus-position?${query.toString()}`)
        if (!res.ok) throw new Error("即時公車 API 讀取失敗")

        const data = (await res.json()) as LiveBusPositionResponse
        if (stopped) return

        const dataTimestamp =
          parseTdxTimestamp(data.gpsTime) ?? parseTdxTimestamp(data.updateTime)
        const isFreshTimestamp =
          dataTimestamp != null && dataTimestamp !== lastDataTimestamp
        const hasPosition =
          data.tracked &&
          typeof data.lat === "number" &&
          typeof data.lng === "number"
        const position = hasPosition
          ? { lat: data.lat as number, lng: data.lng as number }
          : null

        setState({
          plate,
          position,
          subRouteUID: data.nearStop?.subRouteUID ?? null,
          statusMessage: normalizeLiveBusStatusMessage(data.statusMessage),
          statusTimestamp: dataTimestamp,
          statusToastId: data.statusMessage
            ? liveBusToastId("status-poll")
            : null,
        })

        if (hasPosition) {
          nextDelay = nextLiveBusDelay(dataTimestamp, isFreshTimestamp)
        }

        if (dataTimestamp != null) {
          lastDataTimestamp = dataTimestamp
        }
      } catch {
        if (!stopped) {
          toastLiveBusMessage(
            LIVE_BUS_MESSAGES.apiReadProblem,
            LIVE_BUS_API_READ_PROBLEM_TOAST_ID_PREFIX
          )
          setState((previous) => {
            return {
              plate,
              position: null,
              subRouteUID:
                previous.plate === plate ? previous.subRouteUID : null,
              statusMessage:
                previous.plate === plate ? previous.statusMessage : null,
              statusTimestamp:
                previous.plate === plate ? previous.statusTimestamp : null,
              statusToastId:
                previous.plate === plate ? previous.statusToastId : null,
            }
          })
        }
      }

      if (!stopped) {
        scheduleNextLoad(nextDelay)
      }
    }

    void load()
    return () => {
      stopped = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [plate])

  return {
    position: visibleState.position,
    subRouteUID: visibleState.subRouteUID,
    statusMessage: visibleState.statusMessage,
    statusTimestamp: visibleState.statusTimestamp,
    statusToastId: visibleState.statusToastId,
  }
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function getLiveBusMarkerScale(zoom: number | undefined): number {
  if (zoom === undefined) return LIVE_BUS_MARKER_BASE_SCALE

  const zoomInSteps = Math.max(0, zoom - LIVE_BUS_MARKER_SCALE_START_ZOOM)
  const zoomMultiplier = Math.min(
    1 + zoomInSteps * LIVE_BUS_MARKER_ZOOM_SCALE_STEP,
    LIVE_BUS_MARKER_MAX_SCALE_MULTIPLIER
  )

  return LIVE_BUS_MARKER_BASE_SCALE * zoomMultiplier
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function projectLatLngToLocalMeters(
  point: google.maps.LatLngLiteral,
  origin: google.maps.LatLngLiteral
): ProjectedPoint {
  const originLatRadians = origin.lat * DEGREES_TO_RADIANS

  return {
    x:
      (point.lng - origin.lng) *
      DEGREES_TO_RADIANS *
      EARTH_RADIUS_METERS *
      Math.cos(originLatRadians),
    y: (point.lat - origin.lat) * DEGREES_TO_RADIANS * EARTH_RADIUS_METERS,
  }
}

function unprojectLocalMetersToLatLng(
  point: ProjectedPoint,
  origin: google.maps.LatLngLiteral
): google.maps.LatLngLiteral {
  const originLatRadians = origin.lat * DEGREES_TO_RADIANS

  return {
    lat: origin.lat + (point.y / EARTH_RADIUS_METERS) * RADIANS_TO_DEGREES,
    lng:
      origin.lng +
      (point.x / (EARTH_RADIUS_METERS * Math.cos(originLatRadians))) *
        RADIANS_TO_DEGREES,
  }
}

function getClosestPointOnSegment(
  point: ProjectedPoint,
  start: ProjectedPoint,
  end: ProjectedPoint
): ProjectedPoint {
  const segmentX = end.x - start.x
  const segmentY = end.y - start.y
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY

  if (segmentLengthSquared === 0) return start

  const projectedDistance =
    ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) /
    segmentLengthSquared
  const ratio = clamp(projectedDistance, 0, 1)

  return {
    x: start.x + segmentX * ratio,
    y: start.y + segmentY * ratio,
  }
}

function getRouteSnappedPosition(
  position: google.maps.LatLngLiteral,
  routePath: google.maps.LatLngLiteral[]
): google.maps.LatLngLiteral {
  if (routePath.length < 2) return position

  const projectedPosition = { x: 0, y: 0 }
  let closestRoutePoint: ProjectedPoint | null = null
  let closestDistanceSquared = Number.POSITIVE_INFINITY

  for (let i = 0; i < routePath.length - 1; i++) {
    const start = projectLatLngToLocalMeters(routePath[i], position)
    const end = projectLatLngToLocalMeters(routePath[i + 1], position)
    const candidate = getClosestPointOnSegment(projectedPosition, start, end)
    const distanceSquared =
      candidate.x * candidate.x + candidate.y * candidate.y

    if (distanceSquared < closestDistanceSquared) {
      closestRoutePoint = candidate
      closestDistanceSquared = distanceSquared
    }
  }

  if (
    !closestRoutePoint ||
    Math.sqrt(closestDistanceSquared) > LIVE_BUS_ROUTE_SNAP_MAX_DISTANCE_METERS
  ) {
    return position
  }

  return unprojectLocalMetersToLatLng(closestRoutePoint, position)
}

function useMapZoom() {
  const map = useMap()
  const [zoom, setZoom] = useState<number>()

  useEffect(() => {
    if (!map) return

    const syncZoom = () => {
      setZoom(map.getZoom())
    }

    syncZoom()
    const listener = map.addListener("zoom_changed", syncZoom)
    return () => listener.remove()
  }, [map])

  return zoom
}

function useAnimatedLatLng(position: google.maps.LatLngLiteral) {
  const [animatedPosition, setAnimatedPosition] =
    useState<google.maps.LatLngLiteral>(position)
  const animatedPositionRef = useRef(position)

  useEffect(() => {
    const from = animatedPositionRef.current

    if (from.lat === position.lat && from.lng === position.lng) {
      animatedPositionRef.current = position
      setAnimatedPosition(position)
      return
    }

    let frame = 0
    let stopped = false
    const startedAt = performance.now()
    const deltaLat = position.lat - from.lat
    const deltaLng = position.lng - from.lng

    function tick(now: number) {
      if (stopped) return

      const progress = Math.min(
        (now - startedAt) / LIVE_BUS_MOVE_ANIMATION_MS,
        1
      )
      const easedProgress = easeOutCubic(progress)
      const nextPosition = {
        lat: from.lat + deltaLat * easedProgress,
        lng: from.lng + deltaLng * easedProgress,
      }

      animatedPositionRef.current = nextPosition
      setAnimatedPosition(nextPosition)

      if (progress < 1) {
        frame = window.requestAnimationFrame(tick)
      }
    }

    frame = window.requestAnimationFrame(tick)
    return () => {
      stopped = true
      window.cancelAnimationFrame(frame)
    }
  }, [position])

  return animatedPosition
}

function LiveTrackedBusMarker({
  position,
}: {
  position: google.maps.LatLngLiteral
}) {
  const animatedPosition = useAnimatedLatLng(position)
  const markerScale = getLiveBusMarkerScale(useMapZoom())

  return (
    <Marker
      position={animatedPosition}
      zIndex={999}
      icon={{
        url: "/marker.png",
        scaledSize: new google.maps.Size(
          LIVE_BUS_MARKER_ORIGINAL_SIZE.width * markerScale,
          LIVE_BUS_MARKER_ORIGINAL_SIZE.height * markerScale
        ),
        anchor: new google.maps.Point(
          LIVE_BUS_MARKER_ORIGINAL_ANCHOR.x * markerScale,
          LIVE_BUS_MARKER_ORIGINAL_ANCHOR.y * markerScale
        ),
      }}
    />
  )
}

/** 需在已取得 Google Maps API Key 後再掛即時資料與 Sonner（避免不必要請求）。 */
function BusRouteMapInner({
  apiKey,
  plate,
}: {
  apiKey: string
  plate: string
}) {
  const { resolvedTheme } = useTheme()
  const {
    position: liveBusPosition,
    subRouteUID,
    statusMessage,
    statusTimestamp,
    statusToastId,
  } = useLiveTrackedBus(plate)

  useEffect(() => {
    if (statusMessage && statusToastId) {
      toast(
        <TimedToastContent
          sentence={renderLiveBusStatusMessage(statusMessage)}
          timestamp={statusTimestamp ?? Date.now()}
        />,
        {
          id: liveBusToastId(LIVE_BUS_STATUS_TOAST_ID_PREFIX),
          duration: Number.POSITIVE_INFINITY,
          icon: null,
        }
      )
    }
  }, [statusMessage, statusToastId, statusTimestamp])

  const isDarkMap = resolvedTheme === "dark"
  const routeAccent = isDarkMap ? ROUTE_ACCENT_DARK : ROUTE_ACCENT_LIGHT
  /**
   * colorScheme 須與自訂 styles 一致：`FOLLOW_SYSTEM` 只認 OS，按下 d 強制亮／暗時會與
   * resolvedTheme 脫勾，向量底圖內建的深淺路徑與 JSON style 疊加，常在圖磚交界出現異常線條。
   */
  const mapColorScheme = isDarkMap ? ColorScheme.DARK : ColorScheme.LIGHT
  const activeRoute =
    routes.find((route) => route.subRouteUID === subRouteUID) ?? fixedRoute
  const routePath = activeRoute?.path ?? path
  const markerPosition = liveBusPosition
    ? getRouteSnappedPosition(liveBusPosition, routePath)
    : null

  // 外層不參與 tab 順序，並關閉子節點 outline，避免 globals 的 * outline 在圖上閃爍
  return (
    <div
      className="h-svh w-full overflow-hidden outline-none [&_*:focus]:outline-none [&_*:focus-visible]:outline-none"
      tabIndex={-1}
    >
      <APIProvider apiKey={apiKey}>
        <Map
          className="size-full outline-none [&_*:focus]:outline-none [&_*:focus-visible]:outline-none"
          defaultCenter={defaultCenter}
          defaultZoom={11}
          gestureHandling="greedy"
          disableDefaultUI
          zoomControl
          clickableIcons={false}
          styles={isDarkMap ? darkMapStyles : cleanMapStyles}
          colorScheme={mapColorScheme}
        >
          <FitRouteBounds path={routePath} />
          {routePath.length > 1 ? (
            <Polyline
              path={routePath}
              strokeColor={routeAccent}
              strokeOpacity={0.95}
              strokeWeight={3.3}
              geodesic
            />
          ) : null}
          {markerPosition ? (
            <LiveTrackedBusMarker position={markerPosition} />
          ) : null}
        </Map>
      </APIProvider>
    </div>
  )
}

export function BusRouteMap({ plate }: { plate?: string }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const selectedPlate = normalizeTrackedBusPlate(plate)

  if (!apiKey) {
    return (
      <div
        className="h-svh w-full shrink-0 bg-muted"
        role="alert"
        aria-label={LIVE_BUS_MESSAGES.missingGoogleMapsApiKey}
      />
    )
  }

  return <BusRouteMapInner apiKey={apiKey} plate={selectedPlate} />
}
