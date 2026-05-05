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
/** 淺色主題地點標記色 */
const AD_LOCATION_MARKER_BLUE_LIGHT = "#3b82f6"
/** 深色主題地點標記色 */
const AD_LOCATION_MARKER_BLUE_DARK = "#2563eb"

/** 將視窗縮放至包住整條路線 */
function FitRouteBounds({
  disabled,
  path,
}: {
  disabled: boolean
  path: google.maps.LatLngLiteral[]
}) {
  const map = useMap()

  useEffect(() => {
    if (!map || disabled || path.length === 0) return

    const fit = () => {
      const bounds = new google.maps.LatLngBounds()
      for (const p of path) bounds.extend(p)
      map.fitBounds(bounds, ROUTE_VIEW_PADDING)
    }

    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [disabled, map, path])

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

type LiveBusPositionResponse = {
  tracked?: boolean
  lat?: number
  lng?: number
  subRouteUID?: string | null
  direction?: number | null
  nearStop?: {
    subRouteUID?: string | null
    direction?: number | null
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
  position: google.maps.LatLngLiteral | null
  subRouteUID: string | null
  direction: number | null
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
    tracked: false,
    position: null,
    subRouteUID: null,
    direction: null,
    statusMessage: null,
    statusTimestamp: null,
    statusToastId: null,
  })
  const visibleState =
    state.plate === plate
      ? state
      : {
          plate,
          tracked: false,
          position: null,
          subRouteUID: null,
          direction: null,
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
        const direction =
          typeof data.direction === "number" && Number.isFinite(data.direction)
            ? data.direction
            : typeof data.nearStop?.direction === "number" &&
                Number.isFinite(data.nearStop.direction)
              ? data.nearStop.direction
              : null

        setState({
          plate,
          tracked: Boolean(data.tracked),
          position,
          subRouteUID: data.subRouteUID ?? data.nearStop?.subRouteUID ?? null,
          direction,
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
              tracked: previous.plate === plate ? previous.tracked : false,
              position: null,
              subRouteUID:
                previous.plate === plate ? previous.subRouteUID : null,
              direction: previous.plate === plate ? previous.direction : null,
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
    tracked: visibleState.tracked,
    position: visibleState.position,
    subRouteUID: visibleState.subRouteUID,
    direction: visibleState.direction,
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
    text.className = "block whitespace-nowrap text-sm font-bold leading-none"
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
    position: liveBusPosition,
    subRouteUID,
    direction,
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
  const adLocationMarkerBlue = isDarkMap
    ? AD_LOCATION_MARKER_BLUE_DARK
    : AD_LOCATION_MARKER_BLUE_LIGHT
  const routeStopLabelStroke = isDarkMap
    ? ROUTE_STOP_LABEL_STROKE_DARK
    : ROUTE_STOP_LABEL_STROKE_LIGHT
  /**
   * colorScheme 須與自訂 styles 一致：`FOLLOW_SYSTEM` 只認 OS，按下 d 強制亮／暗時會與
   * resolvedTheme 脫勾，向量底圖內建的深淺路徑與 JSON style 疊加，常在圖磚交界出現異常線條。
   */
  const mapColorScheme = isDarkMap ? ColorScheme.DARK : ColorScheme.LIGHT
  const activeStopRoute = liveBusTracked
    ? findActiveStopRoute(subRouteUID, direction)
    : null
  const activeRoute = liveBusTracked
    ? findActiveRoute(activeStopRoute, subRouteUID)
    : null
  const routePath = activeRoute?.path ?? []
  const routeStops = activeStopRoute?.Stops ?? []
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
