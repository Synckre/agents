"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type SelectValueType = string | number | null

function Select<
  Value extends SelectValueType,
  Multiple extends boolean | undefined = undefined
>(props: SelectPrimitive.Root.Props<Value, Multiple>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "group/trigger flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3 text-sm text-foreground shadow-sm outline-none transition-colors focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 data-[popup-open]:border-ring",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
        <ChevronDownIcon className="size-4 transition-transform group-data-[popup-open]/trigger:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex-1 truncate text-left", className)}
      {...props}
    />
  )
}

function SelectPortal(props: SelectPrimitive.Portal.Props) {
  return <SelectPrimitive.Portal data-slot="select-portal" {...props} />
}

function SelectBackdrop({ className, ...props }: SelectPrimitive.Backdrop.Props) {
  return (
    <SelectPrimitive.Backdrop
      data-slot="select-backdrop"
      className={cn(
        "fixed inset-0 z-50 bg-black/40 data-starting-style:opacity-0 data-ending-style:opacity-0 data-starting-style:transition-opacity data-ending-style:transition-opacity data-starting-style:duration-150 data-ending-style:duration-100",
        className
      )}
      {...props}
    />
  )
}

function SelectPositioner({ className, ...props }: SelectPrimitive.Positioner.Props) {
  return (
    <SelectPrimitive.Positioner
      data-slot="select-positioner"
      side="bottom"
      align="start"
      sideOffset={4}
      className={cn("z-50", className)}
      {...props}
    />
  )
}

function SelectPopup({ className, ...props }: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Popup
      data-slot="select-popup"
      className={cn(
        "max-h-[var(--anchor-popup-available-height)] min-w-[calc(var(--anchor-width)+0.5rem)] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-1.5 text-zinc-100 shadow-2xl shadow-indigo-500/10",
        "data-starting-style:opacity-0 data-starting-style:scale-95 data-starting-style:transition-all data-starting-style:duration-100",
        "data-ending-style:opacity-0 data-ending-style:scale-95 data-ending-style:transition-all data-ending-style:duration-100",
        className
      )}
      {...props}
    />
  )
}

function SelectList({ className, ...props }: SelectPrimitive.List.Props) {
  return (
    <SelectPrimitive.List
      data-slot="select-list"
      className={cn("flex flex-col gap-0.5", className)}
      {...props}
    />
  )
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2.5 pr-8 text-sm outline-none transition-colors",
        "focus:bg-zinc-800 focus:text-zinc-50 data-[highlighted]:bg-zinc-800 data-[highlighted]:text-zinc-50 data-[selected]:bg-indigo-500/15 data-[selected]:text-indigo-200",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center justify-center">
        <CheckIcon className="size-3.5" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectItemText({ className, ...props }: SelectPrimitive.ItemText.Props) {
  return (
    <SelectPrimitive.ItemText
      data-slot="select-item-text"
      className={cn("truncate", className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPortal,
  SelectBackdrop,
  SelectPositioner,
  SelectPopup,
  SelectList,
  SelectItem,
  SelectItemText,
}
