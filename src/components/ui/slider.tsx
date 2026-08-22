import * as React from "react"

import { cn } from "@/lib/utils"

export interface SliderProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}

/**
 * A single-thumb range slider built on a native <input type="range">, styled to
 * match the design tokens. The filled portion of the track is driven by a CSS
 * gradient computed from the current value so it reads correctly in both themes.
 */
const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value, onValueChange, min = 0, max = 100, step = 1, ...props }, ref) => {
    const pct = max === min ? 0 : ((value - min) / (max - min)) * 100
    return (
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onValueChange(Number(e.target.value))}
        style={{
          background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${pct}%, var(--border-strong) ${pct}%, var(--border-strong) 100%)`,
        }}
        className={cn(
          "h-2 w-full cursor-pointer appearance-none rounded-full outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          // WebKit thumb
          "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-card [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow",
          // Firefox thumb
          "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-card [&::-moz-range-thumb]:bg-primary",
          className
        )}
        {...props}
      />
    )
  }
)
Slider.displayName = "Slider"

export { Slider }
