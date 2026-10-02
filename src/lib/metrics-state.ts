import type { MetricsState } from "@/hooks/use-metrics"

/**
 * What every page says about the metrics feed, in one place. Before this the
 * same five states were worded in six files and drifted ("unreachable" here,
 * "unavailable" there). Only `off` may tell an operator to change the server's
 * configuration — QA showed "Enable [metrics]" for the seconds a large first
 * scrape takes, which is `loading`, not `off`.
 *
 * - `short`: a pill, a table cell, a footer ("metrics off").
 * - `sentence`: a callout or an empty state, a full sentence.
 * - `tone`: how loudly to say it.
 */
export const METRICS_STATE_TEXT: Record<
  MetricsState,
  { short: string; sentence: string; tone: "muted" | "info" | "warning" }
> = {
  loading: {
    short: "loading metrics",
    sentence: "Loading metrics — the first scrape of a large instance can take a few seconds.",
    tone: "muted",
  },
  warming: {
    short: "rates after the next sample",
    sentence: "One sample so far: totals and latency are since the server started; rates follow the next poll (~10 s).",
    tone: "muted",
  },
  live: { short: "live", sentence: "", tone: "muted" },
  off: {
    short: "metrics off",
    sentence: "Metrics are off on this server. Enable [metrics] to see request rates, errors, latency and per-channel traffic.",
    tone: "info",
  },
  error: {
    short: "metrics unreachable",
    sentence: "The last metrics scrape failed; figures shown are from the last good sample, if any.",
    tone: "warning",
  },
}

/** The short label for a state, for a figure that is missing because of it. */
export const metricsShort = (state: MetricsState) => METRICS_STATE_TEXT[state].short
