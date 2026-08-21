import { ClerkProvider } from "@clerk/nextjs"
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
  title: "Synckre Agent — Enterprise Control Center",
  description: "Plataforma de Agente Autónomo Empresarial de Synckre",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const clerkPubKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
  const htmlClass = cn("dark antialiased", fontMono.variable, "font-sans", geist.variable);

  if (!clerkPubKey.startsWith("pk_")) {
    return (
      <html lang="es" className={htmlClass}>
        <body className="bg-zinc-950 text-zinc-100 min-h-screen p-8">
          <p>Falta NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY en el build de Coolify (Build Argument / env).</p>
        </body>
      </html>
    );
  }

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      signInUrl="/login"
      signUpUrl="/login"
    >
      <html
        lang="es"
        suppressHydrationWarning
        className={htmlClass}
      >
        <body className="bg-zinc-950 text-zinc-100 min-h-screen" suppressHydrationWarning>
          <ThemeProvider>
            <LayoutWrapper>{children}</LayoutWrapper>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
