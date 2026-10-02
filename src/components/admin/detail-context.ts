import { createContext } from "react"

/**
 * The title of the detail page an action sits on, provided by `DetailHeader`
 * around its actions. `LifecycleActions` reads it as the name a delete must
 * be confirmed by typing, so every detail page gets type-to-confirm without
 * each caller passing its own name down.
 */
export const DetailTitleContext = createContext<string | null>(null)
