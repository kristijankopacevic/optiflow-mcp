// Feature arms and episode identity.
//
// Faithfully ported from
// `vendor/token-optimizer-mcp/plugin/hooks/lib/experiment.mjs`
// (MIT-licensed — see THIRD_PARTY_LICENSES.md), with `usageFrom` omitted —
// it is not reachable from either hook this tree ports (verified: neither
// `pretooluse-router.mjs` nor `precompact-optimize.mjs` imports it, directly
// or transitively; it feeds an evaluation-harness usage parser used only by
// hook entry points this phase does not port).
//
// `featuresForArm`/`experimentArm` ARE core: the router uses `features.
// {routing,retrieval,capture,harvest}` to gate whole enforcement categories
// (see `pretooluse.ts`), so despite the word "experiment" in the filename
// this is a real behavior switch, not analytics. Left wired exactly as
// vendor ships it — `TOKEN_OPTIMIZER_EXPERIMENT_ARM` unset defaults to
// `'full'` (every category on), which is the correct default for a single
// deployed fork that isn't running vendor's own live A/B research
// experiment.
//
// `episodeMeta` is ALSO ported faithfully (it's ~30 lines of pure object
// construction, no I/O) but per this phase's core-vs-peripheral finding, its
// output only ever flows into `record(dir, { ...episode, ... })` analytics
// calls in `inject.ts` — never into a branch that changes what's allowed,
// denied, or injected. Those `record()` calls are themselves stubbed as
// peripheral (see `metrics.ts`), so `episodeMeta` is threaded through for
// shape-fidelity with vendor's call sites but has no effect on this fork's
// behavior today.

export const EXPERIMENT_ARMS = ["baseline", "optimizer", "retrieval", "full"] as const;
export type ExperimentArm = (typeof EXPERIMENT_ARMS)[number];

const FEATURES: Record<ExperimentArm, { routing: boolean; retrieval: boolean; capture: boolean; harvest: boolean }> = {
  baseline: { routing: false, retrieval: false, capture: false, harvest: false },
  optimizer: { routing: true, retrieval: false, capture: false, harvest: false },
  retrieval: { routing: true, retrieval: true, capture: true, harvest: false },
  full: { routing: true, retrieval: true, capture: true, harvest: true },
};

export function experimentArm(env: NodeJS.ProcessEnv = process.env): ExperimentArm {
  const requested = String(env.TOKEN_OPTIMIZER_EXPERIMENT_ARM || "").trim().toLowerCase();
  return (EXPERIMENT_ARMS as readonly string[]).includes(requested) ? (requested as ExperimentArm) : "full";
}

export function featuresForArm(arm: ExperimentArm = experimentArm()) {
  return FEATURES[arm] || FEATURES.full;
}

const first = (...values: Array<unknown>) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

export interface EpisodeMeta {
  schemaVersion: number;
  episodeId: string;
  sessionId: string;
  turnId: string | null;
  toolCallId: string | null;
  taskId: string | null;
  pairId: string | null;
  arm: ExperimentArm;
  client: string;
  clientVersion: string | null;
  model: string | null;
  modelVersion: string | null;
}

/** Normalises identifiers exposed under different names by lifecycle clients. */
export function episodeMeta({
  client,
  raw = {},
  payload = {},
  env = process.env,
}: {
  client?: string;
  raw?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
} = {}): EpisodeMeta {
  const sessionId = String(
    first(
      payload.session_id, raw.session_id, raw.sessionId, raw.conversation_id,
      raw.conversationId, raw.taskId, raw.task_id, raw.trajectory_id, "default"
    )
  );
  const episodeId = String(first(env.TOKEN_OPTIMIZER_EPISODE_ID, raw.episode_id, raw.episodeId, sessionId));
  const toolCallId = first(
    raw.tool_use_id, raw.toolUseId, raw.tool_call_id, raw.toolCallId,
    raw.call_id, raw.callId,
    (raw.postToolUse as Record<string, unknown> | undefined)?.toolUseId,
    (raw.preToolUse as Record<string, unknown> | undefined)?.toolUseId
  );
  const model = first(payload.model, (raw.model as Record<string, unknown> | undefined)?.slug, raw.model, raw.model_name, env.TOKEN_OPTIMIZER_MODEL);
  const clientVersion = first(raw.client_version, raw.clientVersion, raw.version, env.TOKEN_OPTIMIZER_CLIENT_VERSION);
  const modelVersion = first(raw.model_version, raw.modelVersion, env.TOKEN_OPTIMIZER_MODEL_VERSION);

  return {
    schemaVersion: 2,
    episodeId,
    sessionId,
    turnId: (first(raw.turn_id, raw.turnId, raw.message_id, raw.messageId) as string | undefined) ?? null,
    toolCallId: toolCallId == null ? null : String(toolCallId),
    taskId: (first(env.TOKEN_OPTIMIZER_TASK_ID, raw.task_id, raw.taskId) as string | undefined) ?? null,
    pairId: (first(env.TOKEN_OPTIMIZER_PAIR_ID, raw.pair_id, raw.pairId) as string | undefined) ?? null,
    arm: experimentArm(env),
    client: String(client || first(raw.client, raw.client_name, "unknown")),
    clientVersion: clientVersion == null ? null : String(clientVersion),
    model: model == null ? null : String(model),
    modelVersion: modelVersion == null ? null : String(modelVersion),
  };
}
