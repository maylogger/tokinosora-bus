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
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import routePaths from "@/data/bus-route-paths.json"
import { cleanMapStyles } from "@/lib/clean-map-styles"
import { darkMapStyles } from "@/lib/dark-map-styles"
import {
  TRACKED_BUS_DIRECTION_DISPLAY,
  normalizeTrackedBusPlate,
} from "@/lib/live-bus-config"

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

/** 與 Sonner toast id 對應，讓不同時間點的靠站動態保留成歷史訊息 */
const LIVE_BUS_STATUS_TOAST_ID_PREFIX = "live-bus-status"
/** A1/A2 任一邊沒拿到資料時，用固定 id 避免提示重複堆疊 */
const LIVE_BUS_API_READ_PROBLEM_TOAST_ID = "live-bus-api-read-problem"
const LIVE_BUS_API_READ_PROBLEM_MESSAGE = "API 讀取出問題，請聯繫勞哥回報狀況"

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
  updateTime?: string | null
  gpsTime?: string | null
}

type LiveBusNearStopResponse = {
  tracked?: boolean
  updateTime?: string | null
  gpsTime?: string | null
  nearStop?: LiveBusNearStop | null
}

type LiveBusNearStop = {
  routeName?: string | null
  directionDisplay?: string | null
  stopSequence?: number | null
  stopName?: string | null
  updateTime?: string | null
  gpsTime?: string | null
}

type LiveTrackedBusState = {
  plate: string
  position: google.maps.LatLngLiteral | null
  nearStop: LiveBusNearStop | null
  statusUpdateKey: string | null
  showApiReadProblemHint: boolean
}

type LiveBusNearStopLoadResult = {
  apiReadOk: boolean
  hasNearStop: boolean
}

type ProjectedPoint = {
  x: number
  y: number
}

const liveBusStatusTimeFormatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

function parseTdxTimestamp(value: string | null | undefined): number | null {
  if (!value) return null

  const normalized = value.trim().replace(" ", "T")
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
  const timestamp = Date.parse(hasTimeZone ? normalized : `${normalized}+08:00`)

  return Number.isFinite(timestamp) ? timestamp : null
}

function formatLiveBusStatusTime(nearStop: LiveBusNearStop): string | null {
  const timestamp =
    parseTdxTimestamp(nearStop.gpsTime) ??
    parseTdxTimestamp(nearStop.updateTime)

  return timestamp ? liveBusStatusTimeFormatter.format(timestamp) : null
}

function formatLiveBusStatusMessage(
  plate: string,
  nearStop: LiveBusNearStop | null
): string | null {
  if (!nearStop?.stopName) return null

  const directionDisplay =
    nearStop.directionDisplay?.trim() || TRACKED_BUS_DIRECTION_DISPLAY
  const stopText =
    typeof nearStop.stopSequence === "number"
      ? `第 ${nearStop.stopSequence} 站「${nearStop.stopName}」`
      : `「${nearStop.stopName}」`

  return `空媽公車（${plate}）正在「${directionDisplay}」${stopText}`
}

function getLiveBusStatusUpdateKey(
  nearStop: LiveBusNearStop,
  dataTimestamp: number | null
): string {
  const nearStopKey = [
    nearStop?.gpsTime ?? "",
    nearStop?.updateTime ?? "",
    nearStop?.stopSequence ?? "",
    nearStop?.stopName ?? "",
  ].join("|")

  return `${dataTimestamp ?? "no-a2"}|${nearStopKey}`
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
    nearStop: null,
    statusUpdateKey: null,
    showApiReadProblemHint: false,
  })
  const visibleState =
    state.plate === plate
      ? state
      : {
          plate,
          position: null,
          nearStop: null,
          statusUpdateKey: null,
          showApiReadProblemHint: false,
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

    async function loadNearStop(): Promise<LiveBusNearStopLoadResult> {
      try {
        const query = new URLSearchParams({ plate, source: "near-stop" })
        const res = await fetch(`/api/bus-position?${query.toString()}`)
        if (!res.ok) return { apiReadOk: false, hasNearStop: false }

        const data = (await res.json()) as LiveBusNearStopResponse
        if (stopped) return { apiReadOk: true, hasNearStop: false }
        if (!data.tracked || !data.nearStop) {
          return { apiReadOk: true, hasNearStop: false }
        }

        const nearStop = data.nearStop
        const dataTimestamp =
          parseTdxTimestamp(nearStop.gpsTime) ??
          parseTdxTimestamp(nearStop.updateTime) ??
          parseTdxTimestamp(data.gpsTime) ??
          parseTdxTimestamp(data.updateTime)
        const statusUpdateKey = getLiveBusStatusUpdateKey(
          nearStop,
          dataTimestamp
        )

        setState((previous) => ({
          plate,
          position: previous.plate === plate ? previous.position : null,
          nearStop,
          statusUpdateKey,
          showApiReadProblemHint: false,
        }))
        return { apiReadOk: true, hasNearStop: true }
      } catch {
        /** A2 暫時失敗時保持目前畫面，下一輪輪詢會再補抓。 */
        return { apiReadOk: false, hasNearStop: false }
      }
    }

    async function load() {
      let nextDelay = LIVE_BUS_FALLBACK_RETRY_MS
      const nearStopResult = await loadNearStop()
      if (stopped) return

      try {
        const query = new URLSearchParams({ plate })
        const res = await fetch(`/api/bus-position?${query.toString()}`)
        if (!res.ok) throw new Error("A1 API 讀取失敗")

        const data = (await res.json()) as LiveBusPositionResponse
        if (stopped) return

        const dataTimestamp =
          parseTdxTimestamp(data.gpsTime) ?? parseTdxTimestamp(data.updateTime)
        const isFreshTimestamp =
          dataTimestamp != null && dataTimestamp !== lastDataTimestamp

        if (
          data.tracked &&
          typeof data.lat === "number" &&
          typeof data.lng === "number"
        ) {
          const position = { lat: data.lat, lng: data.lng }
          setState((previous) => ({
            plate,
            position,
            nearStop: previous.plate === plate ? previous.nearStop : null,
            statusUpdateKey:
              previous.plate === plate ? previous.statusUpdateKey : null,
            showApiReadProblemHint: !nearStopResult.apiReadOk,
          }))
          nextDelay = nextLiveBusDelay(dataTimestamp, isFreshTimestamp)
        } else {
          setState((previous) => {
            return {
              plate,
              position: null,
              nearStop:
                nearStopResult.hasNearStop && previous.plate === plate
                  ? previous.nearStop
                  : null,
              statusUpdateKey:
                nearStopResult.hasNearStop && previous.plate === plate
                  ? previous.statusUpdateKey
                  : null,
              showApiReadProblemHint: !nearStopResult.apiReadOk,
            }
          })
        }

        if (dataTimestamp != null) {
          lastDataTimestamp = dataTimestamp
        }
      } catch {
        if (!stopped) {
          setState((previous) => {
            return {
              plate,
              position: null,
              nearStop:
                nearStopResult.hasNearStop && previous.plate === plate
                  ? previous.nearStop
                  : null,
              statusUpdateKey:
                nearStopResult.hasNearStop && previous.plate === plate
                  ? previous.statusUpdateKey
                  : null,
              showApiReadProblemHint: true,
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
    nearStop: visibleState.nearStop,
    statusUpdateKey: visibleState.statusUpdateKey,
    showApiReadProblemHint: visibleState.showApiReadProblemHint,
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
  plate,
  position,
}: {
  plate: string
  position: google.maps.LatLngLiteral
}) {
  const animatedPosition = useAnimatedLatLng(position)
  const markerScale = getLiveBusMarkerScale(useMapZoom())

  return (
    <Marker
      position={animatedPosition}
      title={`即時車位 ${plate}`}
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
    nearStop,
    statusUpdateKey,
    showApiReadProblemHint,
  } = useLiveTrackedBus(plate)
  const lastStatusToastKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (showApiReadProblemHint) {
      toast(LIVE_BUS_API_READ_PROBLEM_MESSAGE, {
        id: LIVE_BUS_API_READ_PROBLEM_TOAST_ID,
        duration: Number.POSITIVE_INFINITY,
        icon: null,
      })
      return
    }

    toast.dismiss(LIVE_BUS_API_READ_PROBLEM_TOAST_ID)
  }, [showApiReadProblemHint])

  useEffect(() => {
    if (nearStop) {
      const message = formatLiveBusStatusMessage(plate, nearStop)
      const timeText = formatLiveBusStatusTime(nearStop)

      if (
        message &&
        statusUpdateKey &&
        statusUpdateKey !== lastStatusToastKeyRef.current
      ) {
        toast(
          <div className="flex flex-col gap-1">
            <span>{message}</span>
            {timeText ? (
              <span className="text-xs text-muted-foreground">{timeText}</span>
            ) : null}
          </div>,
          {
            id: `${LIVE_BUS_STATUS_TOAST_ID_PREFIX}-${statusUpdateKey}`,
            duration: Number.POSITIVE_INFINITY,
            icon: null,
          }
        )
        lastStatusToastKeyRef.current = statusUpdateKey
      }
    }
  }, [nearStop, statusUpdateKey, plate])

  useEffect(() => {
    return () => {
      toast.dismiss(LIVE_BUS_API_READ_PROBLEM_TOAST_ID)
    }
  }, [])

  const isDarkMap = resolvedTheme === "dark"
  const routeAccent = isDarkMap ? ROUTE_ACCENT_DARK : ROUTE_ACCENT_LIGHT
  /**
   * colorScheme 須與自訂 styles 一致：`FOLLOW_SYSTEM` 只認 OS，按下 d 強制亮／暗時會與
   * resolvedTheme 脫勾，向量底圖內建的深淺路徑與 JSON style 疊加，常在圖磚交界出現異常線條。
   */
  const mapColorScheme = isDarkMap ? ColorScheme.DARK : ColorScheme.LIGHT
  const markerPosition = liveBusPosition
    ? getRouteSnappedPosition(liveBusPosition, path)
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
          <FitRouteBounds path={path} />
          {path.length > 1 ? (
            <Polyline
              path={path}
              strokeColor={routeAccent}
              strokeOpacity={0.95}
              strokeWeight={3.3}
              geodesic
            />
          ) : null}
          {markerPosition ? (
            <LiveTrackedBusMarker plate={plate} position={markerPosition} />
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
        aria-label="缺少 Google Maps API 金鑰，請於 .env.local 設定 API KEY"
      />
    )
  }

  return <BusRouteMapInner apiKey={apiKey} plate={selectedPlate} />
}
