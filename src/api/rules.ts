import { api } from "./client"
import type { Rule, ListRulesParams, PaginatedResponse, StatusChangeRequest, TestRuleRequest, TestRuleResponse } from "./types"

function buildQuery(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
  if (entries.length === 0) return ""
  return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")
}

export const rulesApi = {
  list: (params: ListRulesParams = {}) =>
    api.get<PaginatedResponse<Rule>>(`admin/rules${buildQuery(params as Record<string, string | number | undefined>)}`),

  get: (id: string) =>
    api.get<Rule>(`admin/rules/${id}`),

  changeStatus: (id: string, req: StatusChangeRequest) =>
    api.patch<Rule>(`admin/rules/${id}/status`, req),

  test: (id: string, req: TestRuleRequest) =>
    api.post<TestRuleResponse>(`admin/rules/${id}/test`, req),
}
