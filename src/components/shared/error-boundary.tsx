import { Component, type ErrorInfo, type ReactNode } from "react"
import { ErrorState } from "@/components/shared/error-state"

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches a render error below it so one broken page does not blank the whole
 * console. A class because React still hands render errors only to
 * `getDerivedStateFromError` / `componentDidCatch`. Mount it with a `key` that
 * changes on navigation so the next route starts clean.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error", error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          title="This page hit an error while rendering"
          error={this.state.error}
          onRetry={() => this.setState({ error: null })}
          backTo={{ to: "/", label: "Back to Operations" }}
        />
      )
    }
    return this.props.children
  }
}
