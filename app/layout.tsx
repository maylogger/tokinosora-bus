import type { Metadata } from "next"
import { Geist_Mono, Inter } from "next/font/google"
import { headers } from "next/headers"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { getI18nDictionary, getLocaleFromHeaders } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const locale = getLocaleFromHeaders(await headers())
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
  const locale = getLocaleFromHeaders(await headers())

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
