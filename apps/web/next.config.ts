import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  experimental: {
    // Habilita React View Transitions (App Router bundlea React canary internamente)
    viewTransition: true,
  },
}

export default nextConfig
