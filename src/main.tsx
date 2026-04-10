import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@goplasmatic/dataflow-ui/styles.css"
import "@goplasmatic/datalogic-ui/styles.css"
import "./index.css"
import App from "./app"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
