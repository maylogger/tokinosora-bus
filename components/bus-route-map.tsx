"use client"

import {
  APIProvider,
  ColorScheme,
  Map,
  Marker,
  Polyline,
  RenderingType,
  useMap,
} from "@vis.gl/react-google-maps"
import { Languages } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTheme } from "next-themes"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import { toast } from "sonner"

import { TimedToastContent } from "@/components/timed-toast-content"
import { Button } from "@/components/ui/button"
import bus307Stops from "@/data/bus-307-stops.json"
import routePaths from "@/data/bus-route-paths.json"
import soramamaAdLocation from "@/data/soramama-ad-location.json"
import { cleanMapStyles } from "@/lib/clean-map-styles"
import { darkMapStyles } from "@/lib/dark-map-styles"
import { getI18nDictionary, type Locale } from "@/lib/i18n"
import { normalizeTrackedBusPlate } from "@/lib/live-bus-config"
import {
  getLiveBusMessages,
  type LiveBusStatusMessage,
} from "@/lib/live-bus-messages"
import {
  liveBusSegmentKey,
  updateSegmentWithDebounce,
  type LiveBusDataAge,
  type LiveBusSegment,
  type LiveBusSegmentState,
} from "@/lib/live-bus-segment"

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
    Ja?: string
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
  label?: string
  labels?: Partial<Record<Locale, string>>
  "label-position": "top" | "bottom"
  zoom: number
  position: google.maps.LatLngLiteral
}

const routes = routePaths.routes as BusRoutePathEntry[]
const stopRoutes = bus307Stops as BusRouteStopsEntry[]
const adLocations = soramamaAdLocation as MapPointOfInterest[]
const LANGUAGE_CYCLE: Locale[] = ["en", "ja", "zh-TW"]

const DEFAULT_ROUTE_NAME_ZH = "307"
const defaultCenter: google.maps.LatLngLiteral = {
  lat: 25.030428435,
  lng: 121.51126945,
}
const defaultRoutePath = routes
  .filter((route) => route.routeNameZh === DEFAULT_ROUTE_NAME_ZH)
  .flatMap((route) => route.path)

function localizedTdxName(
  value: { Ja?: string; Zh_tw?: string; En?: string },
  locale: Locale
): string {
  if (locale === "en") {
    return value.En?.trim() || value.Zh_tw?.trim() || value.Ja?.trim() || ""
  }

  if (locale === "ja") {
    return value.Ja?.trim() || value.Zh_tw?.trim() || value.En?.trim() || ""
  }

  return value.Zh_tw?.trim() || value.En?.trim() || value.Ja?.trim() || ""
}

function localizedMapLabel(
  location: MapPointOfInterest,
  locale: Locale
): string {
  return (
    location.labels?.[locale]?.trim() ||
    location.label?.trim() ||
    getI18nDictionary(locale).map.adLocationNiche
  )
}

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
const LIVE_BUS_TOAST_BACKGROUND_IMAGE_URLS = Array.from(
  { length: 7 },
  (_, index) => `/sora-img-${String(index + 1).padStart(2, "0")}.png`
)

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

/** TDX 不是連續 GPS 串流，30 秒輪詢可降低不必要請求。 */
const LIVE_BUS_REFRESH_INTERVAL_MS = 30_000
/** 新輪詢資料校正位置時，沿用輪詢週期慢慢收斂，避免 marker 瞬移。 */
const LIVE_BUS_CORRECTION_TRANSITION_MS = 30_000
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
const LIVE_BUS_PROGRAMMATIC_ZOOM_GRACE_MS = 300

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
    srcUpdateTime?: string | null
    gpsTime?: string | null
  } | null
  segment?: LiveBusSegment | null
  dataAge?: LiveBusDataAge | null
  nextStopEstimate?: {
    stopSequence?: number | null
    stopUID?: string | null
    stopName?: string | null
    estimateTime?: number | null
    updateTime?: string | null
    srcUpdateTime?: string | null
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
  segment: LiveBusSegment | null
  dataAge: LiveBusDataAge | null
  nextStopEstimate: LiveBusPositionResponse["nextStopEstimate"]
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
      {message.text} <span className="text-nowrap">{message.emoji}</span>
    </>
  )
}

function getRandomLiveBusToastBackgroundImageUrl(): string {
  return LIVE_BUS_TOAST_BACKGROUND_IMAGE_URLS[
    Math.floor(Math.random() * LIVE_BUS_TOAST_BACKGROUND_IMAGE_URLS.length)
  ]
}

function toastLiveBusMessage(
  locale: Locale,
  message: LiveBusStatusMessage,
  idPrefix: string,
  timestamp = Date.now()
) {
  toast.dismiss()
  toast(
    <TimedToastContent
      backgroundImageUrl={getRandomLiveBusToastBackgroundImageUrl()}
      locale={locale}
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

function stationSegmentFromAnchor(
  segment: LiveBusSegment | null
): LiveBusSegment | null {
  if (!segment) return null

  return {
    ...segment,
    fromSequence: segment.anchorSequence,
    toSequence: segment.anchorSequence,
    progressHint: 1,
  }
}

function useLiveTrackedBus(
  locale: Locale,
  plate: string,
  requestedPlate: string | null
) {
  const liveBusMessages = getLiveBusMessages(locale)
  const [state, setState] = useState<LiveTrackedBusState>({
    plate,
    tracked: false,
    subRouteUID: null,
    direction: null,
    nearStop: null,
    segment: null,
    dataAge: null,
    nextStopEstimate: null,
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
          segment: null,
          dataAge: null,
          nextStopEstimate: null,
          positionTimestamp: null,
          statusMessage: null,
          statusTimestamp: null,
          statusToastId: null,
        }

  useEffect(() => {
    let stopped = false
    let timeoutId: number | undefined
    let lastStatusUpdateKey: string | null = null
    let lastStableSegmentKey: string | null = null
    let hasShownApiReadProblem = false
    let segmentState: LiveBusSegmentState = {
      current: null,
      pending: null,
      pendingCount: 0,
    }

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
          locale,
          t: String(Date.now()),
        })
        if (requestedPlate) query.set("plate", requestedPlate)
        const res = await fetch(`/api/bus-position?${query.toString()}`, {
          cache: "no-store",
        })
        if (!res.ok) throw new Error(liveBusMessages.apiReadProblem)

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

        const rawSegment = data.segment ?? null
        const canUpdateSegment =
          Boolean(data.tracked) &&
          rawSegment !== null &&
          data.dataAge?.isFresh !== false
        let nextSegment: LiveBusSegment | null = null
        let shouldUpdatePositionTimestamp = false

        if (canUpdateSegment) {
          const result = updateSegmentWithDebounce(segmentState, rawSegment)
          segmentState = result.state
          nextSegment = result.state.current

          const nextSegmentKey = liveBusSegmentKey(nextSegment)
          shouldUpdatePositionTimestamp =
            result.accepted && nextSegmentKey !== lastStableSegmentKey
          if (shouldUpdatePositionTimestamp) {
            lastStableSegmentKey = nextSegmentKey
          }
        } else if (data.tracked && data.dataAge?.isFresh === false) {
          nextSegment =
            segmentState.current ?? stationSegmentFromAnchor(rawSegment)
        } else {
          segmentState = {
            current: null,
            pending: null,
            pendingCount: 0,
          }
          lastStableSegmentKey = null
        }

        setState((previous) => {
          const previousForPlate = previous.plate === plate ? previous : null
          const visibleSegment =
            nextSegment ??
            (data.dataAge?.isFresh === false ? previousForPlate?.segment : null)
          const nextPositionTimestamp = shouldUpdatePositionTimestamp
            ? loadedAt
            : (previousForPlate?.positionTimestamp ??
              (visibleSegment ? loadedAt : null))

          return {
            plate,
            tracked: Boolean(data.tracked),
            subRouteUID: data.subRouteUID ?? data.nearStop?.subRouteUID ?? null,
            direction,
            nearStop: data.nearStop ?? null,
            segment: visibleSegment ?? null,
            dataAge: data.dataAge ?? null,
            nextStopEstimate: data.nextStopEstimate ?? null,
            positionTimestamp: nextPositionTimestamp,
            statusMessage,
            statusTimestamp: dataTimestamp,
            statusToastId: shouldShowStatusToast
              ? liveBusToastId("status-poll")
              : null,
          }
        })

        lastStatusUpdateKey = statusUpdateKey
      } catch {
        if (!stopped) {
          if (!hasShownApiReadProblem) {
            toastLiveBusMessage(
              locale,
              liveBusMessages.apiReadProblem,
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
              segment: previous.plate === plate ? previous.segment : null,
              dataAge: previous.plate === plate ? previous.dataAge : null,
              nextStopEstimate:
                previous.plate === plate ? previous.nextStopEstimate : null,
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
  }, [liveBusMessages.apiReadProblem, locale, plate, requestedPlate])

  return {
    tracked: visibleState.tracked,
    subRouteUID: visibleState.subRouteUID,
    direction: visibleState.direction,
    nearStop: visibleState.nearStop,
    segment: visibleState.segment,
    dataAge: visibleState.dataAge,
    nextStopEstimate: visibleState.nextStopEstimate,
    positionTimestamp: visibleState.positionTimestamp,
    refreshProgress,
    statusMessage: visibleState.statusMessage,
    statusTimestamp: visibleState.statusTimestamp,
    statusToastId: visibleState.statusToastId,
  }
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
          : clamp(
              (targetDistance - distanceBeforeSegment) / segmentLength,
              0,
              1
            )
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
    projections.find(
      (projection) => projection.stopSequence === stopSequence
    ) ?? null
  )
}

function findKnownStopProjection({
  segment,
  stopProjections,
}: {
  segment: LiveBusSegment | null
  stopProjections: RouteStopProjection[]
}): RouteStopProjection | null {
  if (!segment) return null

  return (
    findStopProjection(stopProjections, segment.toSequence) ??
    findStopProjection(stopProjections, segment.fromSequence)
  )
}

function adjustedEstimateRemainingSeconds(
  nextStopEstimate: LiveBusPositionResponse["nextStopEstimate"],
  now: number
): number | null {
  const estimateTime = nextStopEstimate?.estimateTime
  if (
    typeof estimateTime !== "number" ||
    !Number.isFinite(estimateTime) ||
    estimateTime < 0
  ) {
    return null
  }

  const etaBase =
    parseTdxTimestamp(nextStopEstimate?.updateTime) ??
    parseTdxTimestamp(nextStopEstimate?.srcUpdateTime)
  const elapsedSinceEtaUpdate =
    etaBase === null ? 0 : Math.max(0, (now - etaBase) / 1000)

  return Math.max(0, estimateTime - elapsedSinceEtaUpdate)
}

function estimateEtaProgress({
  nearStop,
  nextStopEstimate,
  now,
  segment,
}: {
  nearStop: LiveBusPositionResponse["nearStop"]
  nextStopEstimate: LiveBusPositionResponse["nextStopEstimate"]
  now: number
  segment: LiveBusSegment
}): number | null {
  if (segment.eventType !== 0) return null

  const estimateStopSequence = nextStopEstimate?.stopSequence
  if (
    typeof estimateStopSequence === "number" &&
    estimateStopSequence !== segment.toSequence
  ) {
    return null
  }

  const remainingSeconds = adjustedEstimateRemainingSeconds(
    nextStopEstimate,
    now
  )
  const eventTimestamp =
    parseTdxTimestamp(nearStop?.gpsTime) ??
    parseTdxTimestamp(nearStop?.updateTime)
  if (remainingSeconds === null || eventTimestamp === null) return null

  const elapsedSeconds = Math.max(0, (now - eventTimestamp) / 1000)
  const totalSeconds = elapsedSeconds + remainingSeconds
  if (totalSeconds <= 0) return 1

  return clamp(elapsedSeconds / totalSeconds, 0, 1)
}

function estimateLiveBusRouteProjection({
  nearStop,
  nextStopEstimate,
  now,
  segment,
  routePath,
  stopProjections,
}: {
  nearStop: LiveBusPositionResponse["nearStop"]
  nextStopEstimate: LiveBusPositionResponse["nextStopEstimate"]
  now: number
  segment: LiveBusSegment | null
  routePath: google.maps.LatLngLiteral[]
  stopProjections: RouteStopProjection[]
}): RoutePathProjection | null {
  if (!segment) return null

  const fromStop = findStopProjection(stopProjections, segment.fromSequence)
  const toStop = findStopProjection(stopProjections, segment.toSequence)
  if (!fromStop || !toStop) return null
  if (fromStop.stopSequence === toStop.stopSequence) return toStop

  const progress =
    estimateEtaProgress({
      nearStop,
      nextStopEstimate,
      now,
      segment,
    }) ?? clamp(segment.progressHint, 0, 1)
  const targetDistance =
    fromStop.distanceAlongRoute +
    (toStop.distanceAlongRoute - fromStop.distanceAlongRoute) * progress
  const position =
    getPositionAtRouteDistance(routePath, targetDistance) ??
    interpolateLatLng(fromStop.position, toStop.position, progress)

  return {
    distanceAlongRoute: targetDistance,
    position,
  }
}

function estimateLiveBusPosition({
  nearStop,
  nextStopEstimate,
  now,
  segment,
  routePath,
  stopProjections,
}: {
  nearStop: LiveBusPositionResponse["nearStop"]
  nextStopEstimate: LiveBusPositionResponse["nextStopEstimate"]
  now: number
  segment: LiveBusSegment | null
  routePath: google.maps.LatLngLiteral[]
  stopProjections: RouteStopProjection[]
}): google.maps.LatLngLiteral | null {
  return (
    estimateLiveBusRouteProjection({
      nearStop,
      nextStopEstimate,
      now,
      segment,
      routePath,
      stopProjections,
    })?.position ?? null
  )
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

function OneFingerQuickZoomGesture({
  onQuickZoomStart,
}: {
  onQuickZoomStart?: () => void
}) {
  const map = useMap()

  useEffect(() => {
    if (!map) return

    const mapDiv = map.getDiv()
    let quickZoomState: QuickZoomGestureState | null = null
    let tapState: TapGestureState | null = null
    let lastTapState: LastTapState | null = null
    let previousFractionalZoomEnabled = false

    const stopTouchEvent = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const restoreMapGestures = () => {
      map.setOptions({
        gestureHandling: "greedy",
        isFractionalZoomEnabled: previousFractionalZoomEnabled,
      })
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
      previousFractionalZoomEnabled =
        map.get("isFractionalZoomEnabled") === true
      map.setOptions({
        gestureHandling: "none",
        isFractionalZoomEnabled: true,
      })
      onQuickZoomStart?.()

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
  }, [map, onQuickZoomStart])

  return null
}

function areLatLngClose(
  a: google.maps.LatLngLiteral | null,
  b: google.maps.LatLngLiteral | null
): boolean {
  if (!a || !b) return a === b

  return (
    Math.abs(a.lat - b.lat) < 0.0000001 && Math.abs(a.lng - b.lng) < 0.0000001
  )
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function interpolateLatLng(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  progress: number
): google.maps.LatLngLiteral {
  return {
    lat: from.lat + (to.lat - from.lat) * progress,
    lng: from.lng + (to.lng - from.lng) * progress,
  }
}

function useLiveBusEstimatedPosition({
  initialPosition,
  nearStop,
  nextStopEstimate,
  positionTimestamp,
  routePath,
  segment,
  stopProjections,
}: {
  initialPosition: google.maps.LatLngLiteral
  nearStop: LiveBusPositionResponse["nearStop"]
  nextStopEstimate: LiveBusPositionResponse["nextStopEstimate"]
  positionTimestamp: number | null
  routePath: google.maps.LatLngLiteral[]
  segment: LiveBusSegment | null
  stopProjections: RouteStopProjection[]
}) {
  const [position, setPosition] =
    useState<google.maps.LatLngLiteral>(initialPosition)
  const positionRef = useRef(initialPosition)
  const lastPositionTimestampRef = useRef(positionTimestamp)
  const correctionTransitionRef = useRef<{
    fromDistanceAlongRoute: number | null
    positionTimestamp: number
    startedAt: number
    from: google.maps.LatLngLiteral
  } | null>(null)
  const latestArgsRef = useRef({
    nearStop,
    nextStopEstimate,
    positionTimestamp,
    routePath,
    segment,
    stopProjections,
  })

  useEffect(() => {
    latestArgsRef.current = {
      nearStop,
      nextStopEstimate,
      positionTimestamp,
      routePath,
      segment,
      stopProjections,
    }

    if (
      positionTimestamp !== null &&
      positionTimestamp !== lastPositionTimestampRef.current
    ) {
      correctionTransitionRef.current = {
        fromDistanceAlongRoute:
          projectPositionToRoutePath(positionRef.current, routePath)
            ?.distanceAlongRoute ?? null,
        positionTimestamp,
        startedAt: performance.now(),
        from: positionRef.current,
      }
    }
    lastPositionTimestampRef.current = positionTimestamp
  }, [
    nearStop,
    nextStopEstimate,
    positionTimestamp,
    routePath,
    segment,
    stopProjections,
  ])

  useEffect(() => {
    let frame = 0
    let stopped = false

    function tick() {
      if (stopped) return

      const latest = latestArgsRef.current
      const tickedAt = performance.now()
      const estimatedProjection =
        latest.positionTimestamp !== null
          ? estimateLiveBusRouteProjection({
              nearStop: latest.nearStop,
              nextStopEstimate: latest.nextStopEstimate,
              now: Date.now(),
              segment: latest.segment,
              routePath: latest.routePath,
              stopProjections: latest.stopProjections,
            })
          : null

      if (estimatedProjection) {
        const correctionTransition = correctionTransitionRef.current
        let nextPosition = estimatedProjection.position

        if (
          correctionTransition &&
          latest.positionTimestamp === correctionTransition.positionTimestamp
        ) {
          const progress = Math.min(
            (tickedAt - correctionTransition.startedAt) /
              LIVE_BUS_CORRECTION_TRANSITION_MS,
            1
          )

          if (progress < 1) {
            const easedProgress = easeOutCubic(progress)
            const interpolatedDistance =
              correctionTransition.fromDistanceAlongRoute === null
                ? null
                : correctionTransition.fromDistanceAlongRoute +
                  (estimatedProjection.distanceAlongRoute -
                    correctionTransition.fromDistanceAlongRoute) *
                    easedProgress
            const routePosition =
              interpolatedDistance === null
                ? null
                : getPositionAtRouteDistance(
                    latest.routePath,
                    interpolatedDistance
                  )

            nextPosition =
              routePosition ??
              interpolateLatLng(
                correctionTransition.from,
                estimatedProjection.position,
                easedProgress
              )
          } else {
            correctionTransitionRef.current = null
          }
        }

        positionRef.current = nextPosition
        setPosition((previous) =>
          areLatLngClose(previous, nextPosition) ? previous : nextPosition
        )
      }

      frame = window.requestAnimationFrame(tick)
    }

    frame = window.requestAnimationFrame(tick)
    return () => {
      stopped = true
      window.cancelAnimationFrame(frame)
    }
  }, [])

  return position
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

function LanguageCycleButton({ locale }: { locale: Locale }) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const label = getI18nDictionary(locale).map.switchLanguageLabel
  const currentIndex = LANGUAGE_CYCLE.indexOf(locale)
  const nextLocale =
    LANGUAGE_CYCLE[(currentIndex + 1) % LANGUAGE_CYCLE.length] ??
    LANGUAGE_CYCLE[0]

  const switchLanguage = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("lang", nextLocale)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [nextLocale, pathname, router, searchParams])

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-lg"
      className="absolute bottom-16 left-4 z-50 rounded-full bg-background/90 text-foreground shadow-lg backdrop-blur hover:bg-muted"
      aria-label={label}
      title={label}
      onClick={switchLanguage}
    >
      <Languages data-icon="inline-start" aria-hidden="true" />
    </Button>
  )
}

function InitialLiveBusFocus({
  focusKey,
  onFocused,
  onProgrammaticZoom,
  position,
}: {
  focusKey: string
  onFocused: () => void
  onProgrammaticZoom: () => void
  position: google.maps.LatLngLiteral
}) {
  const map = useMap()
  const focusedStateRef = useRef<{
    focusKey: string
    map: google.maps.Map
  } | null>(null)

  useEffect(() => {
    if (
      !map ||
      (focusedStateRef.current?.focusKey === focusKey &&
        focusedStateRef.current.map === map)
    ) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      focusedStateRef.current = { focusKey, map }
      onProgrammaticZoom()
      map.moveCamera({
        center: position,
        zoom: INITIAL_LIVE_BUS_FOCUS_ZOOM,
      })
      onFocused()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [focusKey, map, onFocused, onProgrammaticZoom, position])

  return null
}

function LiveBusFollowGestureListener({
  enabled,
  onUserGesture,
  programmaticZoomStartedAtRef,
}: {
  enabled: boolean
  onUserGesture: () => void
  programmaticZoomStartedAtRef: { current: number }
}) {
  const map = useMap()
  const enabledRef = useRef(enabled)

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    if (!map) return

    const pauseFollowing = () => {
      if (enabledRef.current) onUserGesture()
    }
    const pauseFollowingForZoom = () => {
      if (
        performance.now() - programmaticZoomStartedAtRef.current <=
        LIVE_BUS_PROGRAMMATIC_ZOOM_GRACE_MS
      ) {
        return
      }

      pauseFollowing()
    }
    const pauseFollowingForMultiTouch = (event: TouchEvent) => {
      if (event.touches.length > 1) pauseFollowing()
    }
    const mapDiv = map.getDiv()
    const dragListener = map.addListener("dragstart", pauseFollowing)
    const zoomListener = map.addListener("zoom_changed", pauseFollowingForZoom)
    const listenerOptions: AddEventListenerOptions = {
      capture: true,
      passive: true,
    }

    mapDiv.addEventListener("wheel", pauseFollowing, listenerOptions)
    mapDiv.addEventListener(
      "touchstart",
      pauseFollowingForMultiTouch,
      listenerOptions
    )

    return () => {
      dragListener.remove()
      zoomListener.remove()
      mapDiv.removeEventListener("wheel", pauseFollowing, listenerOptions)
      mapDiv.removeEventListener(
        "touchstart",
        pauseFollowingForMultiTouch,
        listenerOptions
      )
    }
  }, [map, onUserGesture, programmaticZoomStartedAtRef])

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
  followEnabled,
  initialPosition,
  nearStop,
  nextStopEstimate,
  onFollowRequest,
  positionTimestamp,
  routePath,
  segment,
  stopProjections,
}: {
  followEnabled: boolean
  initialPosition: google.maps.LatLngLiteral
  nearStop: LiveBusPositionResponse["nearStop"]
  nextStopEstimate: LiveBusPositionResponse["nextStopEstimate"]
  onFollowRequest: () => void
  positionTimestamp: number | null
  routePath: google.maps.LatLngLiteral[]
  segment: LiveBusSegment | null
  stopProjections: RouteStopProjection[]
}) {
  const map = useMap()
  const position = useLiveBusEstimatedPosition({
    initialPosition,
    nearStop,
    nextStopEstimate,
    positionTimestamp,
    routePath,
    segment,
    stopProjections,
  })
  const markerScale = getLiveBusMarkerScale(useMapZoom())

  useEffect(() => {
    if (!map || !followEnabled) return

    const frame = window.requestAnimationFrame(() => {
      map.moveCamera({ center: position })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [followEnabled, map, position])

  return (
    <Marker
      onClick={onFollowRequest}
      position={position}
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
  locale,
  stops,
  color,
  labelStrokeColor,
}: {
  locale: Locale
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
              title={localizedTdxName(stop.StopName, locale)}
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
              locale={locale}
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
  locale,
  stop,
  color,
  strokeColor,
}: {
  locale: Locale
  stop: BusRouteStop
  color: string
  strokeColor: string
}) {
  const position = stopPositionToLatLng(stop)
  const label = localizedTdxName(stop.StopName, locale)

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
  locale,
  location,
  strokeColor,
}: {
  color: string
  locale: Locale
  location: MapPointOfInterest
  strokeColor: string
}) {
  const label = localizedMapLabel(location, locale)

  return (
    <>
      <Marker
        position={location.position}
        title={label}
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
        label={label}
        labelPosition={location["label-position"]}
        color={color}
        strokeColor={strokeColor}
      />
    </>
  )
}

function AdLocationMarkers({
  color,
  locale,
  locations,
  strokeColor,
}: {
  color: string
  locale: Locale
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
          key={localizedMapLabel(location, locale)}
          color={color}
          locale={locale}
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
  locale,
  mapId,
  plate,
  requestedPlate,
}: {
  apiKey: string
  locale: Locale
  mapId?: string
  plate: string
  requestedPlate: string | null
}) {
  const { resolvedTheme } = useTheme()
  const {
    tracked: liveBusTracked,
    subRouteUID,
    direction,
    nearStop,
    segment,
    nextStopEstimate,
    positionTimestamp,
    refreshProgress,
    statusMessage,
    statusToastId,
  } = useLiveTrackedBus(locale, plate, requestedPlate)
  const [liveBusFollowEnabled, setLiveBusFollowEnabled] = useState(false)
  const hasInitialLiveBusFollowStartedRef = useRef(false)
  const programmaticZoomStartedAtRef = useRef(0)
  const enableInitialLiveBusFollow = useCallback(() => {
    if (hasInitialLiveBusFollowStartedRef.current) return

    hasInitialLiveBusFollowStartedRef.current = true
    setLiveBusFollowEnabled(true)
  }, [])
  const enableLiveBusFollow = useCallback(() => {
    hasInitialLiveBusFollowStartedRef.current = true
    setLiveBusFollowEnabled(true)
  }, [])
  const pauseLiveBusFollow = useCallback(() => {
    setLiveBusFollowEnabled(false)
  }, [])
  const noteProgrammaticLiveBusZoom = useCallback(() => {
    programmaticZoomStartedAtRef.current = performance.now()
  }, [])

  useEffect(() => {
    if (statusMessage && statusToastId) {
      toastLiveBusMessage(
        locale,
        statusMessage,
        LIVE_BUS_STATUS_TOAST_ID_PREFIX
      )
    }
  }, [locale, statusMessage, statusToastId])

  const isDarkMap = resolvedTheme === "dark"
  const mapStyles = isDarkMap ? darkMapStyles : cleanMapStyles
  const mapColorScheme = isDarkMap ? ColorScheme.DARK : ColorScheme.LIGHT
  const mapRenderingType = mapId ? RenderingType.VECTOR : undefined
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
      ? (estimateLiveBusPosition({
          nearStop,
          nextStopEstimate,
          now: positionTimestamp,
          segment,
          routePath,
          stopProjections,
        }) ??
        findKnownStopProjection({
          segment,
          stopProjections,
        })?.position ??
        null)
      : null
  const liveBusFollowActive = Boolean(markerPosition) && liveBusFollowEnabled

  useEffect(() => {
    if (markerPosition) return

    hasInitialLiveBusFollowStartedRef.current = false
    const frame = window.requestAnimationFrame(() => {
      setLiveBusFollowEnabled(false)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [markerPosition])

  // 外層不參與 tab 順序，並關閉子節點 outline，避免 globals 的 * outline 在圖上閃爍
  return (
    <div
      className="relative h-svh w-full overflow-hidden outline-none [&_*:focus]:outline-none [&_*:focus-visible]:outline-none"
      tabIndex={-1}
    >
      <LiveBusRefreshProgress progress={refreshProgress} />
      <LanguageCycleButton locale={locale} />
      <APIProvider apiKey={apiKey}>
        <Map
          className="size-full outline-none [&_*:focus]:outline-none [&_*:focus-visible]:outline-none"
          defaultCenter={defaultCenter}
          defaultZoom={11}
          gestureHandling="greedy"
          colorScheme={mapColorScheme}
          disableDefaultUI
          isFractionalZoomEnabled={false}
          mapId={mapId}
          renderingType={mapRenderingType}
          styles={mapId ? undefined : mapStyles}
          zoomControl
          clickableIcons={false}
        >
          <LiveBusFollowGestureListener
            enabled={liveBusFollowActive}
            onUserGesture={pauseLiveBusFollow}
            programmaticZoomStartedAtRef={programmaticZoomStartedAtRef}
          />
          <OneFingerQuickZoomGesture onQuickZoomStart={pauseLiveBusFollow} />
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
              locale={locale}
              stops={routeStops}
              color={routeAccent}
              labelStrokeColor={routeStopLabelStroke}
            />
          ) : null}
          <AdLocationMarkers
            color={adLocationMarkerBlue}
            locale={locale}
            locations={adLocations}
            strokeColor={routeStopLabelStroke}
          />
          {markerPosition ? (
            <>
              <InitialLiveBusFocus
                focusKey={mapColorScheme}
                onFocused={enableInitialLiveBusFollow}
                onProgrammaticZoom={noteProgrammaticLiveBusZoom}
                position={markerPosition}
              />
              <LiveTrackedBusMarker
                followEnabled={liveBusFollowActive}
                initialPosition={markerPosition}
                nearStop={nearStop}
                nextStopEstimate={nextStopEstimate}
                onFollowRequest={enableLiveBusFollow}
                positionTimestamp={positionTimestamp}
                routePath={routePath}
                segment={segment}
                stopProjections={stopProjections}
              />
            </>
          ) : null}
        </Map>
      </APIProvider>
    </div>
  )
}

export function BusRouteMap({
  locale,
  plate,
}: {
  locale: Locale
  plate?: string
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
  const selectedPlate = normalizeTrackedBusPlate(plate)
  const requestedPlate = plate?.trim() || null
  const liveBusMessages = getLiveBusMessages(locale)

  if (!apiKey) {
    return (
      <div
        className="h-svh w-full shrink-0 bg-muted"
        role="alert"
        aria-label={liveBusMessages.missingGoogleMapsApiKey}
      />
    )
  }

  return (
    <BusRouteMapInner
      apiKey={apiKey}
      locale={locale}
      mapId={mapId}
      plate={selectedPlate}
      requestedPlate={requestedPlate}
    />
  )
}
