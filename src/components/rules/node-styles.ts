export const functionStyles: Record<string, { color: string; bg: string; label: string }> = {
  parse_json: { color: "text-blue-700", bg: "bg-blue-50 border-blue-200", label: "Parse JSON" },
  parse_xml: { color: "text-blue-700", bg: "bg-blue-50 border-blue-200", label: "Parse XML" },
  map: { color: "text-purple-700", bg: "bg-purple-50 border-purple-200", label: "Map" },
  filter: { color: "text-amber-700", bg: "bg-amber-50 border-amber-200", label: "Filter" },
  validation: { color: "text-amber-700", bg: "bg-amber-50 border-amber-200", label: "Validation" },
  http_call: { color: "text-green-700", bg: "bg-green-50 border-green-200", label: "HTTP Call" },
  enrich: { color: "text-green-700", bg: "bg-green-50 border-green-200", label: "Enrich" },
  publish_kafka: { color: "text-orange-700", bg: "bg-orange-50 border-orange-200", label: "Publish Kafka" },
  publish_json: { color: "text-orange-700", bg: "bg-orange-50 border-orange-200", label: "Publish JSON" },
  publish_xml: { color: "text-orange-700", bg: "bg-orange-50 border-orange-200", label: "Publish XML" },
  log: { color: "text-gray-600", bg: "bg-gray-50 border-gray-200", label: "Log" },
}

export function getFunctionStyle(fn: string) {
  return functionStyles[fn] ?? { color: "text-gray-600", bg: "bg-gray-50 border-gray-200", label: fn }
}
