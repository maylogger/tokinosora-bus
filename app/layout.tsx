import type { Metadata } from "next"
import { Geist_Mono, Inter } from "next/font/google"
import { cookies, headers } from "next/headers"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import {
  getI18nDictionary,
  getLocaleFromHeaders,
  LOCALE_COOKIE_NAME,
  normalizeLocale,
} from "@/lib/i18n"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const dynamic = "force-dynamic"

async function getPreferredLocale() {
  const cookieStore = await cookies()

  return (
    normalizeLocale(cookieStore.get(LOCALE_COOKIE_NAME)?.value) ??
    getLocaleFromHeaders(await headers())
  )
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getPreferredLocale()
  const dictionary = getI18nDictionary(locale)
  const siteTitle = dictionary.metadata.title
  const siteDescription = dictionary.metadata.description

  return {
    metadataBase: new URL("https://tokinosora.maylogger.com/"),
    title: siteTitle,
    description: siteDescription,
    openGraph: {
      title: siteTitle,
      siteName: siteTitle,
      description: siteDescription,
      images: [
        {
          url: "/og-image.jpg?v=53fbd9623159",
          alt: siteTitle,
        },
      ],
      type: "website",
    },
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getPreferredLocale()

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        inter.variable
      )}
    >
      <body>
        <ThemeProvider>
          {children}
          {/* expand：多則 toast 時一併展開，否則僅最前一則可見文字（其餘為堆疊縮影） */}
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  )
}
