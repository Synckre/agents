"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { cn } from "@/lib/utils"

function AlertDialog(props: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({ className, ...props }: AlertDialogPrimitive.Trigger.Props) {
  return (
    <AlertDialogPrimitive.Trigger
      data-slot="alert-dialog-trigger"
      className={cn("", className)}
      {...props}
    />
  )
}

function AlertDialogPortal(props: AlertDialogPrimitive.Portal.Props) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogBackdrop({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-backdrop"
      className={cn(
        "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-starting-style:opacity-0 data-ending-style:opacity-0 data-starting-style:transition-opacity data-ending-style:transition-opacity data-starting-style:duration-200 data-ending-style:duration-150",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogPopup({ className, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Popup
      data-slot="alert-dialog-popup"
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-100 shadow-2xl shadow-indigo-500/10",
        "data-starting-style:opacity-0 data-starting-style:-translate-x-1/2 data-starting-style:-translate-y-[48%] data-starting-style:scale-95 data-starting-style:transition-all data-starting-style:duration-200",
        "data-ending-style:opacity-0 data-ending-style:-translate-x-1/2 data-ending-style:-translate-y-[48%] data-ending-style:scale-95 data-ending-style:transition-all data-ending-style:duration-150",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-base font-bold leading-none text-zinc-100", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm text-zinc-400", className)}
      {...props}
    />
  )
}

function AlertDialogClose({ className, ...props }: AlertDialogPrimitive.Close.Props) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-close"
      className={cn("", className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
  AlertDialogTrigger,
}
