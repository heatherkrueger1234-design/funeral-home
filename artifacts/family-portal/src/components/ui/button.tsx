import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/*
 * The button.
 *
 * This replaces the scaffold's version, which leaned on `hover-elevate`,
 * `active-elevate-2` and `--button-outline` — none of which exist in this
 * project's stylesheet. The practical effect was that every button in the
 * product was inert under the cursor: no hover, no press, no shadow. That is
 * the single cheapest-looking thing a screen can do, so it is written out
 * properly here in the tokens the rest of the product actually uses.
 *
 * The press is a half-pixel drop rather than a scale or a bounce. Nothing in
 * a product about funerals should spring.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md",
    "text-sm font-semibold select-none",
    "transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.2,0.6,0.3,1)]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
    "disabled:pointer-events-none disabled:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    "active:translate-y-[0.5px]",
  ].join(" "),
  {
    variants: {
      variant: {
        /* The one thing to do on this screen. There is never more than one. */
        default:
          "bg-[var(--accent)] text-white shadow-[var(--elevation-1)] hover:bg-[var(--accent-deep)] hover:shadow-[var(--elevation-2)] active:shadow-[var(--elevation-1)]",
        destructive:
          "bg-[var(--destructive)] text-white shadow-[var(--elevation-1)] hover:brightness-110 focus-visible:outline-[var(--destructive)]",
        outline:
          "border border-[var(--border-strong)] bg-[var(--card)] text-foreground shadow-[var(--elevation-1)] hover:border-[var(--accent)] hover:bg-[var(--sunken)]",
        secondary:
          "bg-[var(--muted)] text-foreground hover:bg-[color-mix(in_oklab,var(--muted)_80%,var(--foreground)_6%)]",
        ghost:
          "text-foreground/85 hover:bg-[var(--muted)] hover:text-foreground",
        link:
          "text-[var(--accent-deep)] underline underline-offset-4 decoration-[var(--accent)]/35 hover:decoration-[var(--accent)]",
      },
      size: {
        /*
         * Generous. A director clicks these two hundred times a day and a
         * family member clicks them through tears; neither is served by the
         * 32px buttons a dense admin tool would use.
         */
        /*
         * 44px at the smallest (CRAFT.md's floor for a touch target), on
         * every size including `sm` — "small" here means less padding and
         * less weight on the page, never less to aim at.
         */
        default: "min-h-11 px-4 py-2",
        sm: "min-h-11 rounded-md px-3",
        lg: "min-h-12 rounded-lg px-7 text-base",
        icon: "size-11 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
