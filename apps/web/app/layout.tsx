import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import { LayoutWrapper } from "@/components/LayoutWrapper"

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata = {
  title: "Synckre Agent V2 — Enterprise Control Center",
  description: "Plataforma de Agente Autónomo Empresarial de Synckre",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={cn("dark antialiased", fontMono.variable, "font-sans", geist.variable)}
    >
      <body className="bg-zinc-950 text-zinc-100 min-h-screen" suppressHydrationWarning>
        <ThemeProvider>
          <LayoutWrapper>{children}</LayoutWrapper>
        </ThemeProvider>
      </body>
    </html>
  )
}
