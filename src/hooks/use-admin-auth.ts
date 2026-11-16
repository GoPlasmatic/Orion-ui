import { useSyncExternalStore } from "react"
import { getAdminAuth, subscribeAdminAuth, type AdminAuthState } from "@/api/auth"

/** The admin credential this tab holds and what the server has said about it (see `api/auth.ts`). */
export function useAdminAuth(): AdminAuthState {
  return useSyncExternalStore(subscribeAdminAuth, getAdminAuth, getAdminAuth)
}

/**
 * Whether to offer a mutating verb. False once a mutating request was refused
 * as read-only; true otherwise — a key's authority is not announced in
 * advance, so until the server says otherwise the verb is offered and the
 * first refusal turns every other one off with the reason.
 */
export function useCanMutate(): boolean {
  return useAdminAuth().access !== "read-only"
}

/** Why a mutating verb is not offered, for its tooltip or disabled caption. */
export const READ_ONLY_REASON =
  "This console holds a read-only admin key. Viewing, planning and the authoring checks work; changes need a full-access key."
