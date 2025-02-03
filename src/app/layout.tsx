import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import PostHogProvider from "@/components/providers/posthog-provider"
import { Analytics } from "@vercel/analytics/react"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Meeting • Screenpipe",
  description: "The AI notepad for people in back-to-back meetings",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body 
        suppressHydrationWarning={true}
        className={`${geistSans.variable} ${geistMono.variable} antialiased h-screen`}
      >
        <PostHogProvider>
          <main className="h-full p-4 overflow-hidden">
            {children}
          </main>
          <Toaster />
          <Analytics mode={process.env.NODE_ENV === 'development' ? 'development' : 'production'} />
        </PostHogProvider>
      </body>
    </html>
  )
}
