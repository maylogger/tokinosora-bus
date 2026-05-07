import type { Metadata } from "next"
import { Geist_Mono, Inter } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

const siteTitle = "空媽公車即時位置"
const siteDescription =
  "包含空媽公車即時位置資訊與到站預測，還有空媽生日廣告凹槽的位置都在這，希望台灣粉絲多拍一些照片給空媽看唷！"

export const metadata: Metadata = {
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
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
