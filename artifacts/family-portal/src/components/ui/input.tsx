import * as React from "react"

import { cn } from "@/lib/utils"

/*
 * A field reads as a well, not as a button.
 *
 * So: white against the paper background rather than transparent, an inset
 * hairline rather than a drop shadow, and a focus state that is unmistakable
 * — the home's own colour on the border plus a soft ring outside it. The
 * scaffold shipped a 1px ring in a colour that never resolved, which on a
 * cream page was very nearly invisible.
 *
 * 44px tall, everywhere, on every screen size. This is filled in on phones
 * by people who are not steady.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex min-h-11 w-full rounded-md border border-[var(--border-strong)] bg-[var(--card)]",
          "px-3 py-2 text-base",
          "shadow-[inset_0_1px_2px_rgb(40_34_24/0.04)]",
          "transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.2,0.6,0.3,1)]",
          "placeholder:text-[var(--muted-foreground)]/70",
          "file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-foreground",
          "hover:border-[color-mix(in_oklab,var(--accent)_35%,var(--border-strong))]",
          "focus-visible:outline-none focus-visible:border-[var(--accent)]",
          "focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_16%,transparent)]",
          // Needs attention, drawn in the home's deep colour: CRAFT.md keeps
          // red out of the family portal for anything but a failed request.
          "aria-invalid:border-[var(--accent-deep)]",
          "aria-invalid:focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent-deep)_16%,transparent)]",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--muted)]",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
