import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { TabsWrapper } from "@/components/tabs-wrapper"
import { BackendTest } from "@/components/backend-test"

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
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased h-screen`}>
        <BackendTest />
        <main className="h-full p-4">
          <TabsWrapper />
          {children}
        </main>
        <Toaster />
      </body>
    </html>
  )
}
