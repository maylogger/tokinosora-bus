import { RouteMapSection } from "@/components/route-map-section"

type PageProps = {
  searchParams?: Promise<{
    plate?: string | string[]
  }>
}

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams
  const plate = firstSearchParam(params?.plate)

  return (
    <div className="h-svh w-full overflow-hidden">
      <RouteMapSection plate={plate} />
    </div>
  )
}
