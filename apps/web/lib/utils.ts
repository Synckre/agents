import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Variante de Badge según el rol del agente.
 */
export function roleBadgeVariant(role: string): "sky" | "emerald" | "cyan" | "violet" | "amber" | "indigo" {
  const map: Record<string, "sky" | "emerald" | "cyan" | "violet" | "amber" | "indigo"> = {
    customer_support: "sky",
    sales_assistant: "emerald",
    operations_assistant: "cyan",
    administrative_assistant: "violet",
    management_assistant: "amber",
  };
  return map[role] || "indigo";
}

/**
 * Variante de Badge según el dominio RAG.
 */
export function domainBadgeVariant(domain: string): "sky" | "violet" | "emerald" | "amber" | "cyan" {
  const map: Record<string, "sky" | "violet" | "emerald" | "amber" | "cyan"> = {
    public: "sky",
    internal: "violet",
    customer: "emerald",
    department: "amber",
    project: "cyan",
  };
  return map[domain] || "cyan";
}

