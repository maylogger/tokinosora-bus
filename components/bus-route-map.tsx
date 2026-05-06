"use client"

import {
  APIProvider,
  Map,
  Marker,
  Polyline,
  useMap,
} from "@vis.gl/react-google-maps"
import { useTheme } from "next-themes"
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import { toast } from "sonner"

import { TimedToastContent } from "@/components/timed-toast-content"
import bus307Stops from "@/data/bus-307-stops.json"
import routePaths from "@/data/bus-route-paths.json"
import soramamaAdLocation from "@/data/soramama-ad-location.json"
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

type BusRouteStop = {
  StopUID: string
  StopSequence?: number
  StopName: {
    Zh_tw?: string
    En?: string
  }
  StopPosition: {
    PositionLat: number
    PositionLon: number
  }
}

type BusRouteStopsEntry = {
  SubRouteUID: string
  Direction: number
  Stops: BusRouteStop[]
}

type MapPointOfInterest = {
  label: string
  "label-position": "top" | "bottom"
  zoom: number
  position: google.maps.LatLngLiteral
}

const routes = routePaths.routes as BusRoutePathEntry[]
const stopRoutes = bus307Stops as BusRouteStopsEntry[]
const adLocations = soramamaAdLocation as MapPointOfInterest[]

const DEFAULT_ROUTE_NAME_ZH = "307"
const defaultCenter: google.maps.LatLngLiteral = {
  lat: 25.030428435,
  lng: 121.51126945,
}
const defaultRoutePath = routes
  .filter((route) => route.routeNameZh === DEFAULT_ROUTE_NAME_ZH)
  .flatMap((route) => route.path)

/** fitBounds 四邊留白（手機／桌機共用同一組數值） */
const ROUTE_VIEW_PADDING: google.maps.Padding = {
  top: 4,
  bottom: 4,
  left: 4,
  right: 4,
}
/** 預設總覽避免在未發車狀態下縮到跨縣市的範圍。 */
const DEFAULT_ROUTE_OVERVIEW_MIN_ZOOM = 12

/** 與 Sonner toast id 前綴對應，讓不同時間點的訊息保留成歷史紀錄 */
const LIVE_BUS_STATUS_TOAST_ID_PREFIX = "live-bus-status"
const LIVE_BUS_API_READ_PROBLEM_TOAST_ID_PREFIX = "live-bus-api-read-problem"

/** 淺色主題路線與車標強調色 */
const ROUTE_ACCENT_LIGHT = "#ff8ab5"
/** 深色主題路線與車標強調色 */
const ROUTE_ACCENT_DARK = "#db2777"
/** 淺色主題地點標記色 */
const AD_LOCATION_MARKER_BLUE_LIGHT = "#3b82f6"
/** 深色主題地點標記色 */
const AD_LOCATION_MARKER_BLUE_DARK = "#2563eb"

/** 將視窗縮放至包住整條路線 */
function FitRouteBounds({
  disabled,
  minZoom,
  path,
}: {
  disabled: boolean
  minZoom?: number
  path: google.maps.LatLngLiteral[]
}) {
  const map = useMap()

  useEffect(() => {
    if (!map || disabled || path.length === 0) return

    let idleListener: google.maps.MapsEventListener | undefined

    const fit = () => {
      idleListener?.remove()
      const bounds = new google.maps.LatLngBounds()
      for (const p of path) bounds.extend(p)
      map.fitBounds(bounds, ROUTE_VIEW_PADDING)

      if (minZoom === undefined) return

      idleListener = google.maps.event.addListenerOnce(map, "idle", () => {
        const zoom = map.getZoom()
        if (zoom !== undefined && zoom < minZoom) {
          map.setZoom(minZoom)
        }
      })
    }

    fit()
    window.addEventListener("resize", fit)
    return () => {
      idleListener?.remove()
      window.removeEventListener("resize", fit)
    }
  }, [disabled, map, minZoom, path])

  return null
}

/** 主題切換只更新既有地圖樣式，避免重建 Google Maps instance。 */
function MapThemeStyles({ isDarkMap }: { isDarkMap: boolean }) {
  const map = useMap()

  useEffect(() => {
    if (!map) return

    map.setOptions({
      styles: isDarkMap ? darkMapStyles : cleanMapStyles,
    })
  }, [isDarkMap, map])

  return null
}

/** 目前 TDX 資料不是連續 GPS 串流，固定 30 秒更新可降低不必要輪詢。 */
const LIVE_BUS_REFRESH_INTERVAL_MS = 30_000
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
/** A2 只有到離站事件，離站後用保守市區均速沿 polyline 推估。 */
const ESTIMATED_BUS_SPEED_METERS_PER_SECOND = 4
/** 沒收到下一站 A2 前，不讓推估 marker 自行越過下一站。 */
const ESTIMATED_BUS_DEPARTED_MAX_PROGRESS = 0.95
/** 首次載入即時車位後，直接聚焦到街區層級。 */
const INITIAL_LIVE_BUS_FOCUS_ZOOM = 16
/** zoom 14 以上才顯示站牌圓點，避免中距離視角太雜亂。 */
const ROUTE_STOP_MARKER_MIN_ZOOM = 14
/** 放大到巷道路線層級後才顯示站名，避免全線視角過於擁擠。 */
const ROUTE_STOP_LABEL_MIN_ZOOM = 16
const ROUTE_STOP_LABEL_OFFSET_Y_PX = 12
/** label 需在一般點點上方，但低於即時公車 marker。 */
const MAP_LOCATION_LABEL_Z_INDEX = 30
/** 與 light map 的全域 geometry/building 底色一致。 */
const ROUTE_STOP_LABEL_STROKE_LIGHT = "#e4eef8"
/** 與 dark map 的全域 geometry/building 底色一致。 */
const ROUTE_STOP_LABEL_STROKE_DARK = "#1f2733"
const EARTH_RADIUS_METERS = 6_371_000
const DEGREES_TO_RADIANS = Math.PI / 180
const RADIANS_TO_DEGREES = 180 / Math.PI
const MERCATOR_TILE_SIZE = 256
const MERCATOR_MAX_SIN = 0.9999
const QUICK_ZOOM_DOUBLE_TAP_MAX_DELAY_MS = 320
const QUICK_ZOOM_DOUBLE_TAP_MAX_DISTANCE_PX = 36
const QUICK_ZOOM_TAP_MAX_DURATION_MS = 260
const QUICK_ZOOM_TAP_MOVE_TOLERANCE_PX = 10
const QUICK_ZOOM_PIXELS_PER_LEVEL = 90
const QUICK_ZOOM_DEFAULT_MIN_ZOOM = 3
const QUICK_ZOOM_DEFAULT_MAX_ZOOM = 21

type LiveBusPositionResponse = {
  tracked?: boolean
  subRouteUID?: string | null
  direction?: number | null
  nearStop?: {
    subRouteUID?: string | null
    direction?: number | null
    stopSequence?: number | null
    a2EventType?: number | null
    updateTime?: string | null
    gpsTime?: string | null
  } | null
  updateTime?: string | null
  gpsTime?: string | null
  statusMessage?: LiveBusStatusMessage
  statusUpdateKey?: string
  reason?: string
}

type LiveTrackedBusState = {
  plate: string
  tracked: boolean
  subRouteUID: string | null
  direction: number | null
  nearStop: LiveBusPositionResponse["nearStop"]
  positionTimestamp: number | null
  statusMessage: LiveBusStatusMessage | null
  statusTimestamp: number | null
  statusToastId: string | null
}

type LiveBusRefreshProgressState = {
  startedAt: number
  durationMs: number
}

type ProjectedPoint = {
  x: number
  y: number
}

type RoutePathProjection = {
  distanceAlongRoute: number
  position: google.maps.LatLngLiteral
}

type RouteStopProjection = RoutePathProjection & {
  stopSequence: number
}

type MapSize = {
  width: number
  height: number
}

type QuickZoomGestureState = {
  anchorPoint: ProjectedPoint
  mapSize: MapSize
  moved: boolean
  startCenter: google.maps.LatLngLiteral
  startY: number
  startZoom: number
}

type TapGestureState = {
  point: ProjectedPoint
  startedAt: number
  moved: boolean
}

type LastTapState = {
  point: ProjectedPoint
  endedAt: number
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

function toastLiveBusMessage(
  message: LiveBusStatusMessage,
  idPrefix: string,
  timestamp = Date.now()
) {
  toast.dismiss()
  toast(
    <TimedToastContent
      sentence={renderLiveBusStatusMessage(message)}
      timestamp={timestamp}
    />,
    {
      id: liveBusToastId(idPrefix),
      duration: Number.POSITIVE_INFINITY,
      icon: null,
    }
  )
}

function normalizeLiveBusStatusUpdateKey(
  updateKey: string | undefined,
  message: LiveBusStatusMessage | null
): string | null {
  const normalizedKey = updateKey?.trim()
  if (normalizedKey) return normalizedKey
  if (!message) return null

  return typeof message === "string" ? message : message.text
}

function useLiveTrackedBus(plate: string) {
  const [state, setState] = useState<LiveTrackedBusState>({
    plate,
    tracked: false,
    subRouteUID: null,
    direction: null,
    nearStop: null,
    positionTimestamp: null,
    statusMessage: null,
    statusTimestamp: null,
    statusToastId: null,
  })
  const [refreshProgress, setRefreshProgress] =
    useState<LiveBusRefreshProgressState | null>(null)
  const visibleState =
    state.plate === plate
      ? state
      : {
          plate,
          tracked: false,
          subRouteUID: null,
          direction: null,
          nearStop: null,
          positionTimestamp: null,
          statusMessage: null,
          statusTimestamp: null,
          statusToastId: null,
        }

  useEffect(() => {
    let stopped = false
    let timeoutId: number | undefined
    let lastStatusUpdateKey: string | null = null
    let hasShownApiReadProblem = false

    function scheduleNextLoad() {
      const startedAt = Date.now()
      setRefreshProgress({
        startedAt,
        durationMs: LIVE_BUS_REFRESH_INTERVAL_MS,
      })
      timeoutId = window.setTimeout(() => {
        setRefreshProgress(null)
        void load()
      }, LIVE_BUS_REFRESH_INTERVAL_MS)
    }

    async function load() {
      try {
        const query = new URLSearchParams({
          plate,
          t: String(Date.now()),
        })
        const res = await fetch(`/api/bus-position?${query.toString()}`, {
          cache: "no-store",
        })
        if (!res.ok) throw new Error("即時公車 API 讀取失敗")

        const data = (await res.json()) as LiveBusPositionResponse
        if (stopped) return

        hasShownApiReadProblem = false
        const loadedAt = Date.now()
        const dataTimestamp =
          parseTdxTimestamp(data.gpsTime) ?? parseTdxTimestamp(data.updateTime)
        const direction =
          typeof data.direction === "number" && Number.isFinite(data.direction)
            ? data.direction
            : typeof data.nearStop?.direction === "number" &&
                Number.isFinite(data.nearStop.direction)
              ? data.nearStop.direction
              : null
        const statusMessage = normalizeLiveBusStatusMessage(data.statusMessage)
        const statusUpdateKey = normalizeLiveBusStatusUpdateKey(
          data.statusUpdateKey,
          statusMessage
        )
        const shouldShowStatusToast =
          Boolean(statusMessage) && statusUpdateKey !== lastStatusUpdateKey

        setState({
          plate,
          tracked: Boolean(data.tracked),
          subRouteUID: data.subRouteUID ?? data.nearStop?.subRouteUID ?? null,
          direction,
          nearStop: data.nearStop ?? null,
          positionTimestamp: loadedAt,
          statusMessage,
          statusTimestamp: dataTimestamp,
          statusToastId: shouldShowStatusToast
            ? liveBusToastId("status-poll")
            : null,
        })

        lastStatusUpdateKey = statusUpdateKey
      } catch {
        if (!stopped) {
          if (!hasShownApiReadProblem) {
            toastLiveBusMessage(
              LIVE_BUS_MESSAGES.apiReadProblem,
              LIVE_BUS_API_READ_PROBLEM_TOAST_ID_PREFIX
            )
            hasShownApiReadProblem = true
          }
          setState((previous) => {
            return {
              plate,
              tracked: previous.plate === plate ? previous.tracked : false,
              subRouteUID:
                previous.plate === plate ? previous.subRouteUID : null,
              direction: previous.plate === plate ? previous.direction : null,
              nearStop: previous.plate === plate ? previous.nearStop : null,
              positionTimestamp:
                previous.plate === plate ? previous.positionTimestamp : null,
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
        scheduleNextLoad()
      }
    }

    void load()
    return () => {
      stopped = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [plate])

  return {
    tracked: visibleState.tracked,
    subRouteUID: visibleState.subRouteUID,
    direction: visibleState.direction,
    nearStop: visibleState.nearStop,
    positionTimestamp: visibleState.positionTimestamp,
    refreshProgress,
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

function getPointDistanceSquared(a: ProjectedPoint, b: ProjectedPoint): number {
  const dx = a.x - b.x
  const dy = a.y - b.y

  return dx * dx + dy * dy
}

function projectLatLngToWorldPixels(
  point: google.maps.LatLngLiteral,
  zoom: number
): ProjectedPoint {
  const scale = 2 ** zoom
  const sinLat = clamp(
    Math.sin(point.lat * DEGREES_TO_RADIANS),
    -MERCATOR_MAX_SIN,
    MERCATOR_MAX_SIN
  )

  return {
    x: MERCATOR_TILE_SIZE * (0.5 + point.lng / 360) * scale,
    y:
      MERCATOR_TILE_SIZE *
      (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) *
      scale,
  }
}

function unprojectWorldPixelsToLatLng(
  point: ProjectedPoint,
  zoom: number
): google.maps.LatLngLiteral {
  const scale = 2 ** zoom
  const worldX = point.x / (MERCATOR_TILE_SIZE * scale)
  const worldY = point.y / (MERCATOR_TILE_SIZE * scale)
  const lng = worldX * 360 - 180
  const latRadians = Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY)))

  return {
    lat: latRadians * RADIANS_TO_DEGREES,
    lng,
  }
}

function getAnchoredZoomCenter({
  anchorPoint,
  currentCenter,
  currentZoom,
  mapSize,
  targetZoom,
}: {
  anchorPoint: ProjectedPoint
  currentCenter: google.maps.LatLngLiteral
  currentZoom: number
  mapSize: MapSize
  targetZoom: number
}): google.maps.LatLngLiteral {
  const centerWorld = projectLatLngToWorldPixels(currentCenter, currentZoom)
  const anchorOffset = {
    x: anchorPoint.x - mapSize.width / 2,
    y: anchorPoint.y - mapSize.height / 2,
  }
  const anchorLatLng = unprojectWorldPixelsToLatLng(
    {
      x: centerWorld.x + anchorOffset.x,
      y: centerWorld.y + anchorOffset.y,
    },
    currentZoom
  )
  const targetAnchorWorld = projectLatLngToWorldPixels(anchorLatLng, targetZoom)

  return unprojectWorldPixelsToLatLng(
    {
      x: targetAnchorWorld.x - anchorOffset.x,
      y: targetAnchorWorld.y - anchorOffset.y,
    },
    targetZoom
  )
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

function getDistanceMeters(
  a: google.maps.LatLngLiteral,
  b: google.maps.LatLngLiteral
): number {
  const projected = projectLatLngToLocalMeters(b, a)

  return Math.hypot(projected.x, projected.y)
}

function projectPositionToRoutePath(
  position: google.maps.LatLngLiteral,
  routePath: google.maps.LatLngLiteral[]
): RoutePathProjection | null {
  if (routePath.length < 2) return null

  let distanceBeforeSegment = 0
  let closestProjection: RoutePathProjection | null = null
  let closestDistanceSquared = Number.POSITIVE_INFINITY

  for (let i = 0; i < routePath.length - 1; i++) {
    const segmentStart = routePath[i]
    const segmentEnd = routePath[i + 1]
    const start = projectLatLngToLocalMeters(segmentStart, position)
    const end = projectLatLngToLocalMeters(segmentEnd, position)
    const candidate = getClosestPointOnSegment({ x: 0, y: 0 }, start, end)
    const candidateDistanceSquared = getPointDistanceSquared(candidate, {
      x: 0,
      y: 0,
    })
    const segmentLength = getDistanceMeters(segmentStart, segmentEnd)

    if (candidateDistanceSquared < closestDistanceSquared) {
      const distanceFromStart = Math.min(
        getDistanceMeters(
          segmentStart,
          unprojectLocalMetersToLatLng(candidate, position)
        ),
        segmentLength
      )
      closestDistanceSquared = candidateDistanceSquared
      closestProjection = {
        distanceAlongRoute: distanceBeforeSegment + distanceFromStart,
        position: unprojectLocalMetersToLatLng(candidate, position),
      }
    }

    distanceBeforeSegment += segmentLength
  }

  return closestProjection
}

function getPositionAtRouteDistance(
  routePath: google.maps.LatLngLiteral[],
  targetDistance: number
): google.maps.LatLngLiteral | null {
  if (routePath.length === 0) return null
  if (routePath.length === 1) return routePath[0]

  let distanceBeforeSegment = 0

  for (let i = 0; i < routePath.length - 1; i++) {
    const segmentStart = routePath[i]
    const segmentEnd = routePath[i + 1]
    const segmentLength = getDistanceMeters(segmentStart, segmentEnd)

    if (targetDistance <= distanceBeforeSegment + segmentLength) {
      const ratio =
        segmentLength === 0
          ? 0
          : clamp((targetDistance - distanceBeforeSegment) / segmentLength, 0, 1)
      return {
        lat: segmentStart.lat + (segmentEnd.lat - segmentStart.lat) * ratio,
        lng: segmentStart.lng + (segmentEnd.lng - segmentStart.lng) * ratio,
      }
    }

    distanceBeforeSegment += segmentLength
  }

  return routePath[routePath.length - 1]
}

function buildRouteStopProjections(
  stops: BusRouteStop[],
  routePath: google.maps.LatLngLiteral[]
): RouteStopProjection[] {
  return stops
    .map((stop, index) => {
      const stopSequence = stop.StopSequence ?? index + 1
      const projection = projectPositionToRoutePath(
        stopPositionToLatLng(stop),
        routePath
      )
      if (!projection) return null

      return {
        ...projection,
        stopSequence,
      }
    })
    .filter((projection): projection is RouteStopProjection =>
      Boolean(projection)
    )
    .sort((a, b) => a.stopSequence - b.stopSequence)
}

function findStopProjection(
  projections: RouteStopProjection[],
  stopSequence: number | null | undefined
): RouteStopProjection | null {
  if (typeof stopSequence !== "number" || !Number.isFinite(stopSequence)) {
    return null
  }

  return (
    projections.find((projection) => projection.stopSequence === stopSequence) ??
    null
  )
}

function estimateDepartedBusPosition({
  eventTimestamp,
  fromStop,
  now,
  routePath,
  toStop,
}: {
  eventTimestamp: number | null
  fromStop: RouteStopProjection
  now: number
  routePath: google.maps.LatLngLiteral[]
  toStop: RouteStopProjection | null
}): google.maps.LatLngLiteral {
  if (!toStop) return fromStop.position

  const segmentDistance = Math.max(
    toStop.distanceAlongRoute - fromStop.distanceAlongRoute,
    0
  )
  if (segmentDistance === 0) return fromStop.position

  const elapsedSeconds = eventTimestamp
    ? Math.max(0, (now - eventTimestamp) / 1000)
    : 0
  const estimatedDistance = Math.min(
    elapsedSeconds * ESTIMATED_BUS_SPEED_METERS_PER_SECOND,
    segmentDistance * ESTIMATED_BUS_DEPARTED_MAX_PROGRESS
  )

  return (
    getPositionAtRouteDistance(
      routePath,
      fromStop.distanceAlongRoute + estimatedDistance
    ) ?? fromStop.position
  )
}

function estimateLiveBusPosition({
  nearStop,
  now,
  routePath,
  stopProjections,
}: {
  nearStop: LiveBusPositionResponse["nearStop"]
  now: number
  routePath: google.maps.LatLngLiteral[]
  stopProjections: RouteStopProjection[]
}): google.maps.LatLngLiteral | null {
  const fromStop = findStopProjection(stopProjections, nearStop?.stopSequence)
  if (!nearStop || !fromStop) return null

  if (nearStop.a2EventType === 1) {
    const toStop = findStopProjection(
      stopProjections,
      (nearStop.stopSequence ?? 0) + 1
    )
    const eventTimestamp =
      parseTdxTimestamp(nearStop.gpsTime) ??
      parseTdxTimestamp(nearStop.updateTime)

    return estimateDepartedBusPosition({
      eventTimestamp,
      fromStop,
      now,
      routePath,
      toStop,
    })
  }

  if (nearStop.a2EventType === 0) {
    const arrivingStop = findStopProjection(
      stopProjections,
      (nearStop.stopSequence ?? 0) + 1
    )

    return arrivingStop?.position ?? fromStop.position
  }

  return fromStop.position
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

function OneFingerQuickZoomGesture() {
  const map = useMap()

  useEffect(() => {
    if (!map) return

    const mapDiv = map.getDiv()
    let quickZoomState: QuickZoomGestureState | null = null
    let tapState: TapGestureState | null = null
    let lastTapState: LastTapState | null = null

    const stopTouchEvent = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const restoreMapGestures = () => {
      map.setOptions({ gestureHandling: "greedy" })
    }

    const cancelQuickZoom = () => {
      if (!quickZoomState) return

      quickZoomState = null
      restoreMapGestures()
    }

    const getTouchPoint = (touch: Touch): ProjectedPoint => {
      const rect = mapDiv.getBoundingClientRect()

      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      }
    }

    const getMapSize = (): MapSize => {
      const rect = mapDiv.getBoundingClientRect()

      return {
        width: rect.width,
        height: rect.height,
      }
    }

    const getMapZoomLimit = (
      key: "minZoom" | "maxZoom",
      fallback: number
    ): number => {
      const value = map.get(key)

      return typeof value === "number" ? value : fallback
    }

    const getClampedZoom = (zoom: number): number => {
      return clamp(
        zoom,
        getMapZoomLimit("minZoom", QUICK_ZOOM_DEFAULT_MIN_ZOOM),
        getMapZoomLimit("maxZoom", QUICK_ZOOM_DEFAULT_MAX_ZOOM)
      )
    }

    const moveCameraForQuickZoom = (
      state: QuickZoomGestureState,
      targetZoom: number
    ) => {
      map.moveCamera({
        center: getAnchoredZoomCenter({
          anchorPoint: state.anchorPoint,
          currentCenter: state.startCenter,
          currentZoom: state.startZoom,
          mapSize: state.mapSize,
          targetZoom,
        }),
        zoom: targetZoom,
      })
    }

    const startQuickZoom = (point: ProjectedPoint): boolean => {
      const center = map.getCenter()?.toJSON()
      const zoom = map.getZoom()
      const mapSize = getMapSize()

      if (!center || zoom === undefined || mapSize.width === 0) return false

      quickZoomState = {
        anchorPoint: point,
        mapSize,
        moved: false,
        startCenter: center,
        startY: point.y,
        startZoom: zoom,
      }
      tapState = null
      lastTapState = null
      map.setOptions({
        gestureHandling: "none",
        isFractionalZoomEnabled: true,
      })

      return true
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (quickZoomState) {
        stopTouchEvent(event)
        return
      }

      if (event.touches.length !== 1) {
        tapState = null
        lastTapState = null
        return
      }

      const point = getTouchPoint(event.touches[0])
      const now = performance.now()
      const canStartQuickZoom =
        lastTapState &&
        now - lastTapState.endedAt <= QUICK_ZOOM_DOUBLE_TAP_MAX_DELAY_MS &&
        getPointDistanceSquared(point, lastTapState.point) <=
          QUICK_ZOOM_DOUBLE_TAP_MAX_DISTANCE_PX ** 2

      if (canStartQuickZoom && startQuickZoom(point)) {
        stopTouchEvent(event)
        return
      }

      tapState = {
        point,
        startedAt: now,
        moved: false,
      }
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (quickZoomState) {
        if (event.touches.length !== 1) {
          stopTouchEvent(event)
          cancelQuickZoom()
          return
        }

        const point = getTouchPoint(event.touches[0])
        const yDelta = point.y - quickZoomState.startY
        quickZoomState.moved =
          quickZoomState.moved ||
          Math.abs(yDelta) > QUICK_ZOOM_TAP_MOVE_TOLERANCE_PX
        moveCameraForQuickZoom(
          quickZoomState,
          getClampedZoom(
            quickZoomState.startZoom + yDelta / QUICK_ZOOM_PIXELS_PER_LEVEL
          )
        )
        stopTouchEvent(event)
        return
      }

      if (!tapState || event.touches.length !== 1) {
        tapState = null
        return
      }

      const point = getTouchPoint(event.touches[0])
      tapState.moved =
        tapState.moved ||
        getPointDistanceSquared(point, tapState.point) >
          QUICK_ZOOM_TAP_MOVE_TOLERANCE_PX ** 2
    }

    const handleTouchEnd = (event: TouchEvent) => {
      if (quickZoomState) {
        if (!quickZoomState.moved) {
          moveCameraForQuickZoom(
            quickZoomState,
            getClampedZoom(quickZoomState.startZoom + 1)
          )
        }
        stopTouchEvent(event)
        cancelQuickZoom()
        return
      }

      if (!tapState || event.changedTouches.length === 0) {
        tapState = null
        return
      }

      const point = getTouchPoint(event.changedTouches[0])
      const now = performance.now()
      const isTap =
        !tapState.moved &&
        now - tapState.startedAt <= QUICK_ZOOM_TAP_MAX_DURATION_MS &&
        getPointDistanceSquared(point, tapState.point) <=
          QUICK_ZOOM_TAP_MOVE_TOLERANCE_PX ** 2

      lastTapState = isTap
        ? {
            point,
            endedAt: now,
          }
        : null
      tapState = null
    }

    const handleTouchCancel = (event: TouchEvent) => {
      if (quickZoomState) stopTouchEvent(event)

      tapState = null
      lastTapState = null
      cancelQuickZoom()
    }

    const listenerOptions: AddEventListenerOptions = {
      capture: true,
      passive: false,
    }

    mapDiv.addEventListener("touchstart", handleTouchStart, listenerOptions)
    mapDiv.addEventListener("touchmove", handleTouchMove, listenerOptions)
    mapDiv.addEventListener("touchend", handleTouchEnd, listenerOptions)
    mapDiv.addEventListener("touchcancel", handleTouchCancel, listenerOptions)

    return () => {
      mapDiv.removeEventListener(
        "touchstart",
        handleTouchStart,
        listenerOptions
      )
      mapDiv.removeEventListener("touchmove", handleTouchMove, listenerOptions)
      mapDiv.removeEventListener("touchend", handleTouchEnd, listenerOptions)
      mapDiv.removeEventListener(
        "touchcancel",
        handleTouchCancel,
        listenerOptions
      )
      restoreMapGestures()
    }
  }, [map])

  return null
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

function LiveBusRefreshProgress({
  progress,
}: {
  progress: LiveBusRefreshProgressState | null
}) {
  if (!progress) return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 z-50 h-1"
    >
      <div
        key={progress.startedAt}
        className="live-bus-refresh-progress h-full origin-left bg-foreground/90"
        style={
          {
            "--live-bus-refresh-duration": `${progress.durationMs}ms`,
          } as CSSProperties
        }
      />
    </div>
  )
}

function InitialLiveBusFocus({
  position,
}: {
  position: google.maps.LatLngLiteral
}) {
  const map = useMap()
  const hasFocusedRef = useRef(false)

  useEffect(() => {
    if (!map || hasFocusedRef.current) return

    const frame = window.requestAnimationFrame(() => {
      hasFocusedRef.current = true
      map.moveCamera({
        center: position,
        zoom: INITIAL_LIVE_BUS_FOCUS_ZOOM,
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [map, position])

  return null
}

function findActiveStopRoute(
  subRouteUID: string | null,
  direction: number | null
): BusRouteStopsEntry | null {
  return (
    stopRoutes.find((route) => route.SubRouteUID === subRouteUID) ??
    stopRoutes.find((route) => route.Direction === direction) ??
    null
  )
}

function findActiveRoute(
  stopRoute: BusRouteStopsEntry | null,
  subRouteUID: string | null
): BusRoutePathEntry | null {
  const routeSubRouteUID = stopRoute?.SubRouteUID ?? subRouteUID

  return routes.find((route) => route.subRouteUID === routeSubRouteUID) ?? null
}

function stopPositionToLatLng(stop: BusRouteStop): google.maps.LatLngLiteral {
  return {
    lat: stop.StopPosition.PositionLat,
    lng: stop.StopPosition.PositionLon,
  }
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

function RouteStopMarkers({
  stops,
  color,
  labelStrokeColor,
}: {
  stops: BusRouteStop[]
  color: string
  labelStrokeColor: string
}) {
  const zoom = useMapZoom()
  const showMarkers =
    typeof zoom === "number" && zoom >= ROUTE_STOP_MARKER_MIN_ZOOM
  const showLabels =
    typeof zoom === "number" && zoom >= ROUTE_STOP_LABEL_MIN_ZOOM

  return (
    <>
      {showMarkers
        ? stops.map((stop) => (
            <Marker
              key={stop.StopUID}
              position={stopPositionToLatLng(stop)}
              title={stop.StopName.Zh_tw ?? stop.StopName.En}
              zIndex={10}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 3.8,
                fillColor: color,
                fillOpacity: 0.95,
                strokeColor: labelStrokeColor,
                strokeOpacity: 0.95,
                strokeWeight: 2,
              }}
            />
          ))
        : null}
      {showLabels
        ? stops.map((stop) => (
            <RouteStopLabel
              key={`label-${stop.StopUID}`}
              stop={stop}
              color={color}
              strokeColor={labelStrokeColor}
            />
          ))
        : null}
    </>
  )
}

function RouteStopLabel({
  stop,
  color,
  strokeColor,
}: {
  stop: BusRouteStop
  color: string
  strokeColor: string
}) {
  const position = stopPositionToLatLng(stop)
  const label = stop.StopName.Zh_tw ?? stop.StopName.En ?? ""

  return (
    <MapLocationLabel
      position={position}
      label={label}
      color={color}
      strokeColor={strokeColor}
    />
  )
}

function MapLocationLabel({
  position,
  label,
  labelPosition = "bottom",
  color,
  strokeColor,
}: {
  position: google.maps.LatLngLiteral
  label: string
  labelPosition?: "top" | "bottom"
  color: string
  strokeColor: string
}) {
  const map = useMap()
  const lat = position.lat
  const lng = position.lng

  useEffect(() => {
    if (!map || !label) return

    const el = document.createElement("div")
    el.style.position = "absolute"
    el.style.left = "0"
    el.style.top = "0"
    el.style.zIndex = String(MAP_LOCATION_LABEL_Z_INDEX)
    el.style.pointerEvents = "none"

    const text = document.createElement("span")
    text.textContent = label
    text.className =
      "block whitespace-pre-line text-center text-sm font-bold leading-tight"
    text.style.color = color
    text.style.transform =
      labelPosition === "top"
        ? `translate(-50%, calc(-100% - ${ROUTE_STOP_LABEL_OFFSET_Y_PX}px))`
        : `translate(-50%, ${ROUTE_STOP_LABEL_OFFSET_Y_PX}px)`
    text.style.webkitTextStroke = `3px ${strokeColor}`
    text.style.paintOrder = "stroke fill"
    text.style.textShadow = `0 1px 2px ${strokeColor}`
    el.appendChild(text)

    const overlay = new google.maps.OverlayView()
    overlay.onAdd = () => {
      overlay.getPanes()?.markerLayer.appendChild(el)
    }
    overlay.draw = () => {
      const projection = overlay.getProjection()
      const point = projection.fromLatLngToDivPixel(
        new google.maps.LatLng({ lat, lng })
      )
      if (!point) return

      el.style.transform = `translate(${point.x}px, ${point.y}px)`
    }
    overlay.onRemove = () => {
      el.remove()
    }

    overlay.setMap(map)

    return () => {
      overlay.setMap(null)
    }
  }, [color, label, labelPosition, lat, lng, map, strokeColor])

  return null
}

function AdLocationMarker({
  color,
  location,
  strokeColor,
}: {
  color: string
  location: MapPointOfInterest
  strokeColor: string
}) {
  return (
    <>
      <Marker
        position={location.position}
        title={location.label}
        zIndex={20}
        icon={{
          path: google.maps.SymbolPath.CIRCLE,
          scale: 5,
          fillColor: color,
          fillOpacity: 0.95,
          strokeColor,
          strokeOpacity: 0.95,
          strokeWeight: 2,
        }}
      />
      <MapLocationLabel
        position={location.position}
        label={location.label}
        labelPosition={location["label-position"]}
        color={color}
        strokeColor={strokeColor}
      />
    </>
  )
}

function AdLocationMarkers({
  color,
  locations,
  strokeColor,
}: {
  color: string
  locations: MapPointOfInterest[]
  strokeColor: string
}) {
  const zoom = useMapZoom()
  const visibleLocations =
    typeof zoom === "number"
      ? locations.filter((location) => zoom >= location.zoom)
      : []

  return (
    <>
      {visibleLocations.map((location) => (
        <AdLocationMarker
          key={location.label}
          color={color}
          location={location}
          strokeColor={strokeColor}
        />
      ))}
    </>
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
    tracked: liveBusTracked,
    subRouteUID,
    direction,
    nearStop,
    positionTimestamp,
    refreshProgress,
    statusMessage,
    statusToastId,
  } = useLiveTrackedBus(plate)

  useEffect(() => {
    if (statusMessage && statusToastId) {
      toastLiveBusMessage(statusMessage, LIVE_BUS_STATUS_TOAST_ID_PREFIX)
    }
  }, [statusMessage, statusToastId])

  const isDarkMap = resolvedTheme === "dark"
  const routeAccent = isDarkMap ? ROUTE_ACCENT_DARK : ROUTE_ACCENT_LIGHT
  const adLocationMarkerBlue = isDarkMap
    ? AD_LOCATION_MARKER_BLUE_DARK
    : AD_LOCATION_MARKER_BLUE_LIGHT
  const routeStopLabelStroke = isDarkMap
    ? ROUTE_STOP_LABEL_STROKE_DARK
    : ROUTE_STOP_LABEL_STROKE_LIGHT
  const activeStopRoute = liveBusTracked
    ? findActiveStopRoute(subRouteUID, direction)
    : null
  const activeRoute = liveBusTracked
    ? findActiveRoute(activeStopRoute, subRouteUID)
    : null
  const routePath = activeRoute?.path ?? []
  const routeStops = activeStopRoute?.Stops ?? []
  const stopProjections =
    liveBusTracked && routePath.length > 1
      ? buildRouteStopProjections(routeStops, routePath)
      : []
  const markerPosition =
    liveBusTracked && positionTimestamp !== null
      ? estimateLiveBusPosition({
          nearStop,
          now: positionTimestamp,
          routePath,
          stopProjections,
        })
      : null

  // 外層不參與 tab 順序，並關閉子節點 outline，避免 globals 的 * outline 在圖上閃爍
  return (
    <div
      className="relative h-svh w-full overflow-hidden outline-none [&_*:focus]:outline-none [&_*:focus-visible]:outline-none"
      tabIndex={-1}
    >
      <LiveBusRefreshProgress progress={refreshProgress} />
      <APIProvider apiKey={apiKey}>
        <Map
          className="size-full outline-none [&_*:focus]:outline-none [&_*:focus-visible]:outline-none"
          defaultCenter={defaultCenter}
          defaultZoom={11}
          gestureHandling="greedy"
          disableDefaultUI
          zoomControl
          clickableIcons={false}
        >
          <MapThemeStyles isDarkMap={isDarkMap} />
          <OneFingerQuickZoomGesture />
          <FitRouteBounds
            disabled={Boolean(markerPosition) || routePath.length > 0}
            minZoom={DEFAULT_ROUTE_OVERVIEW_MIN_ZOOM}
            path={defaultRoutePath}
          />
          <FitRouteBounds disabled={Boolean(markerPosition)} path={routePath} />
          {routePath.length > 1 ? (
            <Polyline
              path={routePath}
              strokeColor={routeAccent}
              strokeOpacity={0.95}
              strokeWeight={3.3}
              geodesic
            />
          ) : null}
          {routeStops.length > 0 ? (
            <RouteStopMarkers
              stops={routeStops}
              color={routeAccent}
              labelStrokeColor={routeStopLabelStroke}
            />
          ) : null}
          <AdLocationMarkers
            color={adLocationMarkerBlue}
            locations={adLocations}
            strokeColor={routeStopLabelStroke}
          />
          {markerPosition ? (
            <>
              <InitialLiveBusFocus position={markerPosition} />
              <LiveTrackedBusMarker position={markerPosition} />
            </>
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
