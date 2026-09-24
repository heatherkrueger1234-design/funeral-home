import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

/*
 * Tabs as a ruled bar, not as pills.
 *
 * A case has eleven of these. The scaffold's pill group put them in a grey
 * tray that had to be told `flex-wrap h-auto` to fit, which on a laptop meant
 * three ragged rows of grey lozenges above every case — the busiest, least
 * legible thing on the screen, sitting directly under the name of somebody
 * who has died.
 *
 * A single rule with the live tab underlined in the home's colour reads as
 * one row whatever the window width, scrolls sideways when it has to, and
 * keeps the ink on the page for the case rather than the navigation.
 */

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "relative flex items-stretch gap-0.5 overflow-x-auto border-b border-border",
      // The rule runs the full width of the bar, under the tabs and past the
      // last one, the way a printed table rules its header.
      "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      // The scrollbar is hidden, so the bar has to say for itself when it
      // runs past the window: a soft shadow appears at whichever edge has
      // more tabs behind it. See `.scroll-hint-x` in index.css.
      "scroll-hint-x",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap",
      "px-2.5 pb-2.5 pt-2 text-sm font-semibold",
      "text-muted-foreground transition-colors duration-200 ease-[cubic-bezier(0.2,0.6,0.3,1)]",
      "hover:text-foreground",
      "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=active]:text-[var(--accent-deep)]",
      // The underline sits on the rule rather than above it, so the live tab
      // looks joined to the panel below.
      "after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full",
      "after:bg-transparent data-[state=active]:after:bg-[var(--accent)]",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
