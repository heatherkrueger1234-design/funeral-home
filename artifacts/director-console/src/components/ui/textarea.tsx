import * as React from "react"

import { cn } from "@/lib/utils"

/*
 * The same well as `Input`, given room. Obituaries and messages get written
 * in these, and a three-line box is a hint that a short answer is expected —
 * which, for "tell us about them", is exactly the wrong hint.
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-28 w-full rounded-md border border-[var(--border-strong)] bg-[var(--card)]",
        "px-3 py-2.5 text-base leading-relaxed",
        "shadow-[inset_0_1px_2px_rgb(40_34_24/0.04)]",
        "transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.2,0.6,0.3,1)]",
        "placeholder:text-[var(--muted-foreground)]/70",
        "hover:border-[color-mix(in_oklab,var(--accent)_35%,var(--border-strong))]",
        "focus-visible:outline-none focus-visible:border-[var(--accent)]",
        "focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_16%,transparent)]",
        "aria-invalid:border-[var(--destructive)]",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--muted)]",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
