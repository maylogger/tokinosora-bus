export const LOCALES = ["zh-TW", "ja", "en"] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = "en"

type HeadersLike = {
  get(name: string): string | null
}

type LiveBusCopy = {
  apiReadProblem: string
  missingGoogleMapsApiKey: string
  notStarted: (busName: string) => string
  updating: string
  startedNoEta: (busName: string) => string
  firstStopFallbackName: string
  nextStopFallbackName: string
  nearStopFallbackName: string
  dataPaused: (busName: string) => string
  notInService: (busName: string) => string
  arrivalText: (minutes: number, stopName: string) => string
  beforeFirstStop: (
    busName: string,
    minutes: number,
    stopName: string
  ) => string
  nextStop: (busName: string, minutes: number, stopName: string) => string
  arrivingAtStop: (busName: string, stopName: string) => string
  departedStop: (busName: string, stopName: string) => string
  departedSegmentLabel: (stopName: string) => string
  arrivedSegmentLabel: (stopName: string) => string
  nearStopNotFoundReason: (busName: string, plate: string) => string
}

type RelativeTimeCopy = {
  justNow: string
  secondsAgo: (seconds: number) => string
  updatedLabel: string
  momentLocale: "zh-tw" | "ja" | "en"
}

export type I18nDictionary = {
  metadata: {
    title: string
    description: string
  }
  brand: {
    busName: string
  }
  route: {
    directionDisplay: string
  }
  liveBus: LiveBusCopy
  relativeTime: RelativeTimeCopy
  map: {
    adLocationNiche: string
    undergroundExitY25: string
  }
}

function minuteUnit(minutes: number): string {
  return minutes === 1 ? "minute" : "minutes"
}

const dictionaries: Record<Locale, I18nDictionary> = {
  "zh-TW": {
    metadata: {
      title: "空媽公車即時位置",
      description:
        "包含空媽公車即時位置資訊與到站預測，還有空媽生日廣告凹槽的位置都在這，希望台灣粉絲多拍一些照片給空媽看唷！",
    },
    brand: {
      busName: "空媽公車",
    },
    route: {
      directionDisplay: "莒光 → 板橋前站",
    },
    liveBus: {
      apiReadProblem: "API 讀取不到，請稍後",
      missingGoogleMapsApiKey:
        "缺少 Google Maps API 金鑰，請於 .env.local 設定 API KEY",
      notStarted: (busName) => `${busName} 目前不在營運狀態`,
      updating: "資料更新中",
      startedNoEta: (busName) => `${busName} 已發車`,
      firstStopFallbackName: "起點站",
      nextStopFallbackName: "下一站",
      nearStopFallbackName: "目前站",
      dataPaused: (busName) => `${busName} 資料暫停更新`,
      notInService: (busName) => `${busName} 目前不在營運狀態`,
      arrivalText: (minutes, stopName) =>
        minutes === 0
          ? `即將到達「${stopName}」`
          : `即將在 ${minutes} 分鐘到達「${stopName}」`,
      beforeFirstStop: (busName, minutes, stopName) =>
        `${busName} 已發車，${dictionaries["zh-TW"].liveBus.arrivalText(
          minutes,
          stopName
        )}`,
      nextStop: (busName, minutes, stopName) =>
        `${busName} ${dictionaries["zh-TW"].liveBus.arrivalText(
          minutes,
          stopName
        )}`,
      arrivingAtStop: (busName, stopName) => `${busName} 進站中「${stopName}」`,
      departedStop: (busName, stopName) => `${busName} 已離開「${stopName}」`,
      departedSegmentLabel: (stopName) => `剛離開「${stopName}」`,
      arrivedSegmentLabel: (stopName) => `抵達「${stopName}」`,
      nearStopNotFoundReason: (busName, plate) =>
        `${busName}（${plate}）未在靠站動態資料中`,
    },
    relativeTime: {
      justNow: "剛剛",
      secondsAgo: (seconds) => `${seconds} 秒前`,
      updatedLabel: "更新時間：",
      momentLocale: "zh-tw",
    },
    map: {
      adLocationNiche: "空媽生日廣告\n地下街凹槽地點",
      undergroundExitY25: "地下街出口 Y25",
    },
  },
  ja: {
    metadata: {
      title: "そらバス現在地",
      description:
        "そらバスの現在地と到着予測、そらちゃん誕生日広告の地下街スポットをまとめています。",
    },
    brand: {
      busName: "そらバス",
    },
    route: {
      directionDisplay: "莒光 → 板橋前站",
    },
    liveBus: {
      apiReadProblem: "API を読み取れません。しばらくしてからお試しください",
      missingGoogleMapsApiKey:
        "Google Maps API キーがありません。.env.local に API KEY を設定してください",
      notStarted: (busName) => `${busName} は現在運行していません`,
      updating: "データ更新中",
      startedNoEta: (busName) => `${busName} は出発しました`,
      firstStopFallbackName: "始発停留所",
      nextStopFallbackName: "次の停留所",
      nearStopFallbackName: "現在の停留所",
      dataPaused: (busName) => `${busName} のデータ更新が一時停止しています`,
      notInService: (busName) => `${busName} は現在運行していません`,
      arrivalText: (minutes, stopName) =>
        minutes === 0
          ? `まもなく「${stopName}」に到着します`
          : `${minutes}分後に「${stopName}」に到着予定です`,
      beforeFirstStop: (busName, minutes, stopName) =>
        `${busName} は出発しました。${dictionaries.ja.liveBus.arrivalText(
          minutes,
          stopName
        )}`,
      nextStop: (busName, minutes, stopName) =>
        `${busName} ${dictionaries.ja.liveBus.arrivalText(minutes, stopName)}`,
      arrivingAtStop: (busName, stopName) =>
        `${busName} が「${stopName}」に到着中です`,
      departedStop: (busName, stopName) =>
        `${busName} は「${stopName}」を出発しました`,
      departedSegmentLabel: (stopName) => `「${stopName}」を出発しました`,
      arrivedSegmentLabel: (stopName) => `「${stopName}」に到着しました`,
      nearStopNotFoundReason: (busName, plate) =>
        `${busName}（${plate}）は到着・出発データ内で見つかりません`,
    },
    relativeTime: {
      justNow: "たった今",
      secondsAgo: (seconds) => `${seconds}秒前`,
      updatedLabel: "更新：",
      momentLocale: "ja",
    },
    map: {
      adLocationNiche: "そらちゃん誕生日広告\n地下街のくぼみ地点",
      undergroundExitY25: "地下街出口 Y25",
    },
  },
  en: {
    metadata: {
      title: "Sora Bus Live Location",
      description:
        "Live location and arrival estimates for Sora Bus, plus the underground concourse spots for Sora's birthday ad.",
    },
    brand: {
      busName: "Sora Bus",
    },
    route: {
      directionDisplay: "Juguang → Banqiao Bus Station",
    },
    liveBus: {
      apiReadProblem: "Unable to read the API. Please try again later.",
      missingGoogleMapsApiKey:
        "Missing Google Maps API key. Set API KEY in .env.local.",
      notStarted: (busName) => `${busName} is currently out of service`,
      updating: "Updating data",
      startedNoEta: (busName) => `${busName} has started service`,
      firstStopFallbackName: "First stop",
      nextStopFallbackName: "Next stop",
      nearStopFallbackName: "Current stop",
      dataPaused: (busName) => `${busName} data updates are paused`,
      notInService: (busName) => `${busName} is currently out of service`,
      arrivalText: (minutes, stopName) =>
        minutes === 0
          ? `Arriving at "${stopName}" soon`
          : `Arriving at "${stopName}" in ${minutes} ${minuteUnit(minutes)}`,
      beforeFirstStop: (busName, minutes, stopName) =>
        `${busName} has departed. ${dictionaries.en.liveBus.arrivalText(
          minutes,
          stopName
        )}`,
      nextStop: (busName, minutes, stopName) =>
        `${busName} ${dictionaries.en.liveBus.arrivalText(minutes, stopName)}`,
      arrivingAtStop: (busName, stopName) =>
        `${busName} is arriving at "${stopName}"`,
      departedStop: (busName, stopName) => `${busName} has left "${stopName}"`,
      departedSegmentLabel: (stopName) => `just left "${stopName}"`,
      arrivedSegmentLabel: (stopName) => `arrived at "${stopName}"`,
      nearStopNotFoundReason: (busName, plate) =>
        `${busName} (${plate}) was not found in near-stop data`,
    },
    relativeTime: {
      justNow: "just now",
      secondsAgo: (seconds) => `${seconds} seconds ago`,
      updatedLabel: "Updated: ",
      momentLocale: "en",
    },
    map: {
      adLocationNiche: "Sora birthday ad\nunderground concourse niche",
      undergroundExitY25: "Underground mall exit Y25",
    },
  },
}

export function getI18nDictionary(locale: Locale): I18nDictionary {
  return dictionaries[locale]
}

export function normalizeLocale(
  value: string | null | undefined
): Locale | null {
  const normalized = value?.trim().replace("_", "-").toLowerCase()
  if (!normalized) return null

  if (normalized === "zh" || normalized === "zh-tw" || normalized === "tw") {
    return "zh-TW"
  }

  if (normalized === "ja" || normalized === "jp" || normalized === "ja-jp") {
    return "ja"
  }

  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en"
  }

  return null
}

export function getLocaleFromCountryCode(
  countryCode: string | null | undefined
): Locale {
  const normalized = countryCode?.trim().toUpperCase()

  if (normalized === "TW") return "zh-TW"
  if (normalized === "JP") return "ja"

  return DEFAULT_LOCALE
}

export function getLocaleFromHeaders(headers: HeadersLike): Locale {
  return getLocaleFromCountryCode(
    headers.get("x-vercel-ip-country") ??
      headers.get("cf-ipcountry") ??
      headers.get("x-country-code") ??
      headers.get("x-country")
  )
}

export function getBusDisplayName(locale: Locale, plate?: string): string {
  const busName = getI18nDictionary(locale).brand.busName
  const normalizedPlate = plate?.trim()

  return normalizedPlate ? `${busName} ${normalizedPlate}` : busName
}
