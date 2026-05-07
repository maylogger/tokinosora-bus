export const LIVE_BUS_A2_MAX_AGE_SECONDS = 120

export type LiveBusA2EventType = 0 | 1 | 2

export type LiveBusSegment = {
  fromSequence: number
  toSequence: number
  anchorSequence: number
  progressHint: number
  label: string
  eventType: LiveBusA2EventType
}

export type LiveBusDataAge = {
  gpsAgeSeconds: number | null
  sourceDelaySeconds: number | null
  isFresh: boolean
}

export type LiveBusSegmentState = {
  current: LiveBusSegment | null
  pending: LiveBusSegment | null
  pendingCount: number
}

export type LiveBusA2SegmentInput = {
  stopSequence?: number | null
  stopName?: string | null
  a2EventType?: number | null
}

export type LiveBusA2TimeInput = {
  gpsTime?: string | null
  srcUpdateTime?: string | null
  updateTime?: string | null
}

export type LiveBusSegmentBounds = {
  firstStopSequence?: number | null
  lastStopSequence?: number | null
}

const DEFAULT_STOP_NAME = "目前站"

function isA2EventType(
  value: number | null | undefined
): value is LiveBusA2EventType {
  return value === 0 || value === 1 || value === 2
}

function clampSequence(
  sequence: number,
  bounds?: LiveBusSegmentBounds
): number {
  const first = bounds?.firstStopSequence
  const last = bounds?.lastStopSequence
  let clamped = sequence

  if (typeof first === "number" && Number.isFinite(first)) {
    clamped = Math.max(clamped, first)
  }

  if (typeof last === "number" && Number.isFinite(last)) {
    clamped = Math.min(clamped, last)
  }

  return clamped
}

export function parseTdxTimestamp(
  value: string | null | undefined
): number | null {
  if (!value) return null

  const normalized = value.trim().replace(" ", "T")
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
  const timestamp = Date.parse(hasTimeZone ? normalized : `${normalized}+08:00`)

  return Number.isFinite(timestamp) ? timestamp : null
}

export function buildLiveBusDataAge(
  input: LiveBusA2TimeInput,
  now = Date.now(),
  maxAgeSeconds = LIVE_BUS_A2_MAX_AGE_SECONDS
): LiveBusDataAge {
  const gpsTimestamp = parseTdxTimestamp(input.gpsTime)
  const srcUpdateTimestamp = parseTdxTimestamp(input.srcUpdateTime)
  const updateTimestamp = parseTdxTimestamp(input.updateTime)
  const gpsAgeSeconds =
    gpsTimestamp === null
      ? null
      : Math.max(0, Math.round((now - gpsTimestamp) / 1000))
  const sourceDelaySeconds =
    srcUpdateTimestamp === null || updateTimestamp === null
      ? null
      : Math.max(0, Math.round((updateTimestamp - srcUpdateTimestamp) / 1000))

  return {
    gpsAgeSeconds,
    sourceDelaySeconds,
    isFresh: gpsAgeSeconds !== null && gpsAgeSeconds <= maxAgeSeconds,
  }
}

export function getSegmentFromA2(
  input: LiveBusA2SegmentInput,
  bounds?: LiveBusSegmentBounds
): LiveBusSegment | null {
  const n = input.stopSequence
  const event = input.a2EventType

  if (typeof n !== "number" || !Number.isFinite(n) || !isA2EventType(event)) {
    return null
  }

  const stopName = input.stopName?.trim() || DEFAULT_STOP_NAME

  if (event === 0) {
    return {
      fromSequence: clampSequence(n, bounds),
      toSequence: clampSequence(n + 1, bounds),
      anchorSequence: n,
      progressHint: 0.15,
      label: `剛離開「${stopName}」`,
      eventType: event,
    }
  }

  if (event === 1) {
    return {
      fromSequence: clampSequence(n - 1, bounds),
      toSequence: clampSequence(n, bounds),
      anchorSequence: n,
      progressHint: 0.95,
      label: `抵達「${stopName}」`,
      eventType: event,
    }
  }

  return {
    fromSequence: clampSequence(n - 1, bounds),
    toSequence: clampSequence(n, bounds),
    anchorSequence: n,
    progressHint: 0.75,
    label: `即將到達「${stopName}」`,
    eventType: event,
  }
}

export function liveBusSegmentKey(
  segment: LiveBusSegment | null
): string | null {
  if (!segment) return null

  return [
    segment.eventType,
    segment.anchorSequence,
    segment.fromSequence,
    segment.toSequence,
  ].join(":")
}

export function updateSegmentWithDebounce(
  state: LiveBusSegmentState,
  next: LiveBusSegment | null,
  maxAnchorJump = 1,
  requiredPendingCount = 2
): { state: LiveBusSegmentState; accepted: boolean } {
  if (!next) {
    return { state, accepted: false }
  }

  if (!state.current) {
    return {
      state: {
        current: next,
        pending: null,
        pendingCount: 0,
      },
      accepted: true,
    }
  }

  const diff = Math.abs(next.anchorSequence - state.current.anchorSequence)
  if (diff <= maxAnchorJump) {
    return {
      state: {
        current: next,
        pending: null,
        pendingCount: 0,
      },
      accepted: true,
    }
  }

  const pendingCount =
    state.pending?.anchorSequence === next.anchorSequence
      ? state.pendingCount + 1
      : 1

  if (pendingCount >= requiredPendingCount) {
    return {
      state: {
        current: next,
        pending: null,
        pendingCount: 0,
      },
      accepted: true,
    }
  }

  return {
    state: {
      current: state.current,
      pending: next,
      pendingCount,
    },
    accepted: false,
  }
}
