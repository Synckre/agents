import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variantStyles = {
    default: "bg-primary text-primary-foreground border-transparent hover:bg-primary/80",
    secondary: "bg-secondary text-secondary-foreground border-transparent hover:bg-secondary/80",
    destructive: "bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20",
    outline: "text-foreground border-border",
    success: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-500 border-amber-500/20 hover:bg-amber-500/20",
    info: "bg-sky-500/10 text-sky-500 border-sky-500/20 hover:bg-sky-500/20",
  }

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        variantStyles[variant],
        className
      )}
      {...props}
    />
  )
}
