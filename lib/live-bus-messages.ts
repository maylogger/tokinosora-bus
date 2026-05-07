import {
  DEFAULT_LOCALE,
  getBusDisplayName,
  getI18nDictionary,
  type Locale,
} from "@/lib/i18n"

export type LiveBusStatusMessage =
  | string
  | {
      text: string
      emoji: string
    }

const ARRIVAL_MESSAGE_EMOJIS = [
  "( `･ㅂ･)و",
  "(✿╹◡╹)ﾉ",
  "(｡•ᴗ•｡)♡",
  "(๑╹ᆺ╹)",
  "(*´꒳`*)ﾟ*.・♡",
  "₍₍ ◝(•̀ㅂ•́)◟ ⁾⁾",
] as const

function liveBusStatusMessage(
  text: string,
  emoji: string
): LiveBusStatusMessage {
  return { text, emoji }
}

function randomArrivalMessageEmoji(): string {
  return ARRIVAL_MESSAGE_EMOJIS[
    Math.floor(Math.random() * ARRIVAL_MESSAGE_EMOJIS.length)
  ]
}

function liveBusDisplayName(locale: Locale, plate?: string): string {
  return plate?.trim() || getBusDisplayName(locale, "EAL-0080")
}

export function getLiveBusMessages(locale: Locale = DEFAULT_LOCALE) {
  const copy = getI18nDictionary(locale).liveBus

  return {
    apiReadProblem: copy.apiReadProblem,
    missingGoogleMapsApiKey: copy.missingGoogleMapsApiKey,
    notStarted: (plate?: string) =>
      liveBusStatusMessage(
        copy.notStarted(liveBusDisplayName(locale, plate)),
        "_(:3」∠)_"
      ),
    updating: liveBusStatusMessage(copy.updating, "( •́ .̫ •̀ )"),
    startedNoEta: (plate?: string) =>
      liveBusStatusMessage(
        copy.startedNoEta(liveBusDisplayName(locale, plate)),
        "(๑╹ᆺ╹)"
      ),
    firstStopFallbackName: copy.firstStopFallbackName,
    nextStopFallbackName: copy.nextStopFallbackName,
    nearStopFallbackName: copy.nearStopFallbackName,
    dataPaused: (plate?: string) =>
      liveBusStatusMessage(
        copy.dataPaused(liveBusDisplayName(locale, plate)),
        "( •́ .̫ •̀ )"
      ),
    notInService: (plate?: string) =>
      liveBusStatusMessage(
        copy.notInService(liveBusDisplayName(locale, plate)),
        "_(:3」∠)_"
      ),
  }
}

export const LIVE_BUS_MESSAGES = getLiveBusMessages()

export function liveBusBeforeFirstStopMessage(
  locale: Locale,
  plate: string,
  minutes: number,
  stopName: string
): LiveBusStatusMessage {
  const copy = getI18nDictionary(locale).liveBus

  return {
    text: copy.beforeFirstStop(
      liveBusDisplayName(locale, plate),
      minutes,
      stopName
    ),
    emoji: randomArrivalMessageEmoji(),
  }
}

export function liveBusNextStopMessage(
  locale: Locale,
  plate: string,
  minutes: number,
  stopName: string
): LiveBusStatusMessage {
  const copy = getI18nDictionary(locale).liveBus

  return {
    text: copy.nextStop(liveBusDisplayName(locale, plate), minutes, stopName),
    emoji: randomArrivalMessageEmoji(),
  }
}

export function liveBusArrivingAtStopMessage(
  locale: Locale,
  plate: string,
  stopName: string
): LiveBusStatusMessage {
  const copy = getI18nDictionary(locale).liveBus

  return {
    text: copy.arrivingAtStop(liveBusDisplayName(locale, plate), stopName),
    emoji: randomArrivalMessageEmoji(),
  }
}

export function liveBusDepartedStopMessage(
  locale: Locale,
  plate: string,
  stopName: string
): LiveBusStatusMessage {
  const copy = getI18nDictionary(locale).liveBus

  return {
    text: copy.departedStop(liveBusDisplayName(locale, plate), stopName),
    emoji: randomArrivalMessageEmoji(),
  }
}

export function liveBusSegmentStatusMessage(
  locale: Locale,
  plate: string,
  label: string
): LiveBusStatusMessage {
  return {
    text: `${liveBusDisplayName(locale, plate)} ${label}`,
    emoji: randomArrivalMessageEmoji(),
  }
}
