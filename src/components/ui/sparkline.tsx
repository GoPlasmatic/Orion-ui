import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts"

// Minimal inline trend line. Stroke uses `currentColor`, so set the color via a
// text utility on the caller (e.g. className="text-chart-1").
export function Sparkline({
  values,
  height = 36,
  className,
}: {
  values: number[]
  height?: number
  className?: string
}) {
  if (values.length < 2) {
    return <div style={{ height }} className={className} />
  }
  const data = values.map((v, i) => ({ i, v }))
  return (
    <div style={{ height }} className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 3, bottom: 3, left: 0, right: 0 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="v"
            stroke="currentColor"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
