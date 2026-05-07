import { headers } from "next/headers"

import { RouteMapSection } from "@/components/route-map-section"
import { getLocaleFromHeaders, normalizeLocale } from "@/lib/i18n"

export const dynamic = "force-dynamic"

type PageProps = {
  searchParams?: Promise<{
    lang?: string | string[]
    plate?: string | string[]
  }>
}

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams
  const plate = firstSearchParam(params?.plate)
  const locale =
    normalizeLocale(firstSearchParam(params?.lang)) ??
    getLocaleFromHeaders(await headers())

  return (
    <div className="h-svh w-full overflow-hidden">
      <RouteMapSection locale={locale} plate={plate} />
    </div>
  )
}
