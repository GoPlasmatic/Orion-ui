import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-error"
import { modelsApi } from "@/api/models"
import { admissionStage } from "@/lib/model-manifest"
import type {
  CreateModelRequest,
  ImportOptions,
  ListModelsParams,
  StatusChangeRequest,
  UpdateModelRequest,
} from "@/api/types"

/**
 * How often a pending admission is re-read, and for how long at that rate.
 *
 * A verdict normally lands in seconds — the probe is five inferences — but
 * `pending` is *not* guaranteed to terminate: with this node's admission
 * worker down a registration waits for a verdict indefinitely, which is a
 * state `/health` reports and both model pages tell the operator about. So the
 * fast poll is bounded and then backs off, rather than sitting at 2 s forever
 * on a page someone left open. "Re-admit" is the manual nudge either way.
 */
const ADMISSION_POLL_MS = 2000
const ADMISSION_POLL_SLOW_MS = 30_000
/** ~30 s of fast polling before backing off. */
const ADMISSION_FAST_POLLS = 15

export function useModels(params: ListModelsParams = {}, enabled = true) {
  return useQuery({
    queryKey: ["models", params],
    queryFn: () => modelsApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/**
 * The latest version, with this node's residency under `health`.
 *
 * Unlike every other entity, a model is not finished when the write returns:
 * `POST admin/models` answers 202 and the node's admission worker fetches,
 * verifies and probes the artifact afterwards. So poll while the verdict is
 * `pending` and stop as soon as it lands — the same shape `useTrace` uses for
 * an async submission.
 */
export function useModel(id: string) {
  return useQuery({
    queryKey: ["models", id],
    queryFn: () => modelsApi.get(id),
    enabled: !!id,
    refetchInterval: (query) => {
      if (query.state.data?.admission?.state !== "pending") return false
      return query.state.dataUpdateCount <= ADMISSION_FAST_POLLS
        ? ADMISSION_POLL_MS
        : ADMISSION_POLL_SLOW_MS
    },
  })
}

export function useModelVersions(id: string) {
  return useQuery({
    queryKey: ["models", id, "versions"],
    queryFn: () => modelsApi.listVersions(id),
    enabled: !!id,
  })
}

export function useModelDependencies(id: string) {
  return useQuery({
    queryKey: ["models", id, "dependencies"],
    queryFn: () => modelsApi.dependencies(id),
    enabled: !!id,
  })
}

export function useCreateModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateModelRequest) => modelsApi.create(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] })
      // Deliberately not "created": the row exists but nothing has verified the
      // bytes yet, and activation is refused until something has.
      toast.success("Model registered — queued for admission on this node")
    },
    onError: (e) => toastError("Failed to register model", e),
  })
}

export function useUpdateModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateModelRequest }) =>
      modelsApi.update(id, req),
    onSuccess: (_data, { req }) => {
      queryClient.invalidateQueries({ queryKey: ["models"] })
      toast.success(
        req.artifact
          ? "Model updated — the changed artifact reference queued it for admission again"
          : "Model updated",
      )
    },
    onError: (e) => toastError("Failed to update model", e),
  })
}

export function useDeleteModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => modelsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] })
      toast.success("Model deleted")
    },
    onError: (e) => toastError("Failed to delete model", e),
  })
}

/**
 * Activating or archiving a model rebuilds the generation's model set: the
 * workflows naming it are re-screened, and under `models.preload = "referenced"`
 * the node warms the session right after the publish. So the workflow list and
 * this node's health are invalidated alongside the model itself.
 *
 * Unlike a plugin, this does *not* move the function vocabulary — `model_infer`
 * is a built-in whose availability never depended on a stored row — so
 * `["functions"]` is left alone.
 */
export function useChangeModelStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: StatusChangeRequest }) =>
      modelsApi.changeStatus(id, req),
    onSuccess: (_data, { req }) => {
      queryClient.invalidateQueries({ queryKey: ["models"] })
      queryClient.invalidateQueries({ queryKey: ["workflows"] })
      queryClient.invalidateQueries({ queryKey: ["engine"] })
      queryClient.invalidateQueries({ queryKey: ["health"] })
      toast.success(`Model ${req.status === "active" ? "activated" : req.status}`)
    },
    onError: (e) => toastError("Failed to change model status", e),
  })
}

/** Untoasted — the findings render inline; a refusal is information. */
export function useModelStatusDryRun() {
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: StatusChangeRequest }) =>
      modelsApi.changeStatusDryRun(id, req),
  })
}

/**
 * Re-run admission on this node. Always sent with `wait` so the verdict is in
 * the response: the 202 form answers with the *old* verdict still on the row,
 * which reads as "nothing happened" to anyone watching the page.
 */
export function useAdmitModel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => modelsApi.admit(id, { wait: true }),
    onSuccess: (model) => {
      queryClient.invalidateQueries({ queryKey: ["models"] })
      queryClient.invalidateQueries({ queryKey: ["health"] })
      const { state, reason } = model.admission
      if (state === "passed") toast.success("Admission passed — the model can be activated")
      else if (state === "failed")
        toastError(
          `Admission failed at ${admissionStage(model.admission)}`,
          new Error(reason ?? "no reason recorded"),
        )
      else toast.info("Admission queued on this node")
    },
    onError: (e) => toastError("Failed to run admission", e),
  })
}

export function useCreateModelVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => modelsApi.createVersion(id),
    onSuccess: (_data, id) => {
      // Prefix match: this covers `["models", id, "versions"]` too.
      queryClient.invalidateQueries({ queryKey: ["models", id] })
      toast.success("New model version created")
    },
    onError: (e) => toastError("Failed to create model version", e),
  })
}

/** Untoasted — the validation envelope, and the object's HEAD, render inline. */
export function useValidateModel() {
  return useMutation({
    mutationFn: (req: CreateModelRequest) => modelsApi.validate(req),
  })
}

export function useImportModels() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ items, ...opts }: { items: CreateModelRequest[] } & ImportOptions) =>
      modelsApi.import(items, opts),
    onSuccess: (_data, vars) => {
      if (!vars.dryRun) queryClient.invalidateQueries({ queryKey: ["models"] })
    },
  })
}
