import * as React from "react"

import { cn } from "@/lib/utils"
import { fieldBase } from "./field"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(fieldBase, "flex min-h-[60px] px-3 py-2 text-base md:text-sm", className)}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
