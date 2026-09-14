import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      // An unchecked box is a well, like every other empty field on the
      // page; a checked one fills with the home's colour. The scaffold drew
      // the empty one with an accent-coloured border, which made a list of
      // ten unticked things look like ten things demanding attention.
      "peer grid size-5 shrink-0 place-content-center rounded border border-[var(--border-strong)] bg-[var(--card)]",
      "shadow-[inset_0_1px_2px_rgb(40_34_24/0.05)]",
      "transition-[background-color,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.2,0.6,0.3,1)]",
      "hover:border-[var(--accent)]",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
      "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[var(--muted)]",
      "data-[state=checked]:border-[var(--accent)] data-[state=checked]:bg-[var(--accent)] data-[state=checked]:text-white data-[state=checked]:shadow-none",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("grid place-content-center text-current")}
    >
      <Check className="size-3.5" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
