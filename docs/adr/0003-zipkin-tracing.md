# 0003 — Add distributed tracing with OpenTelemetry → Zipkin

- **Status:** proposed
- **Date:** 2026-06-17

## Context

The system is now distributed across containers (ADR-0001): each agent sends a
metric over gRPC to the backend, which writes it to Supabase over two REST calls
and broadcasts an SSE update. Today we can see *that* a metric arrived
(`[AGENT:gRPC] Metrics received ...`) but not *where time goes* inside one
request: was the gRPC hop slow, the `servers` upsert, the `metrics` insert, or
PostgREST/Kong?

Metrics tooling (ADR-0002, Grafana) answers "how loaded is server X" over time.
It does **not** answer "for this one request, which step was slow." That is what
distributed tracing provides — a per-request waterfall across services plus a
service-dependency view.

The traced request path (verified in code) is:

```
agent.py: stub.SubmitMetrics()
  └─ grpc.ts: submitMetrics()
       ├─ monitoring.ts: storeAgentMetrics()
       │    ├─ db.ts: upsertServer()   → REST POST /servers   (via Kong → PostgREST → db)
       │    └─ db.ts: insertMetric()   → REST POST /metrics   (via Kong → PostgREST → db)
       └─ sse.ts: broadcastToFrontends()
```

## Decision

Add distributed tracing, self-hosted, with **OpenTelemetry for instrumentation
and Zipkin as the backend + UI**.

1. **Instrument with OpenTelemetry, export to Zipkin.** Application code uses the
   OpenTelemetry SDKs (`opentelemetry-*` for Python, `@opentelemetry/*` for
   Node) and is configured to export spans to Zipkin. Rationale: OTel is the
   vendor-neutral standard, offers auto-instrumentation for gRPC and HTTP (less
   hand-written span code), and decouples *how spans are produced* from *which
   backend stores them*. Switching the backend later (e.g. to Grafana Tempo, see
   ADR-0002) becomes a config change, not a code rewrite. Zipkin-native
   libraries (`py_zipkin`, `zipkin-js`) were rejected for being backend-locked
   and less maintained.

2. **Self-hosted, no credentials.** A `zipkin` container
   (`openzipkin/zipkin`) runs in the Compose stack. Zipkin has no built-in auth
   by design: code posts spans to `http://zipkin:9411/api/v2/spans` with no key,
   and the UI opens with no login. This matches the requirement that tracing be
   fully self-hosted with no Zipkin credentials. Access control is therefore the
   network's job, not Zipkin's (see Consequences).

3. **Dashboard reachable in the browser over a locally exposed port.** The
   Zipkin service publishes port `9411`, so its UI (trace waterfalls + service
   dependency graph) is opened directly at `http://localhost:9411` — exactly the
   same browser-facing, locally-exposed model as Grafana (`:3000`) and the SSE
   frontend (`:8081`). The port is exposed for local use only.

4. **Scope of instrumentation.** Spans are created for the meaningful hops along
   the request path, not just service-to-service calls:
   - the agent's outgoing `SubmitMetrics` gRPC call (client span),
   - the backend's `submitMetrics` handler (server span),
   - each backend → Supabase REST call (`upsertServer`, `insertMetric`) as its
     own child span,
   - optionally the SSE broadcast.
   This makes the two database writes individually visible, which is the most
   likely place latency hides.

5. **Context propagation across the gRPC boundary.** The trace context (trace id
   / span id) is propagated from the Python agent to the Node backend using the
   W3C Trace Context standard (`traceparent`), carried in gRPC metadata, so the
   agent's client span and the backend's server span belong to the same trace.
   OTel's gRPC instrumentation handles injection/extraction on both sides.

6. **In-memory storage for now.** Zipkin runs with its default in-memory store.
   Traces are lost on Zipkin restart, which is acceptable for a local/demo
   setup. Persistent storage (Elasticsearch/Cassandra) is explicitly out of
   scope and would be a separate service if ever needed.

### Proposed shape (for the future implementation)

A `zipkin` service in `supabase/docker-compose.yml`:

```yaml
  zipkin:
    image: openzipkin/zipkin
    container_name: zipkin
    restart: unless-stopped
    ports:
      - "9411:9411"     # browser UI + span ingest
```

Backend and agents receive the exporter target via env:

```
# backend service
OTEL_EXPORTER_ZIPKIN_ENDPOINT=http://zipkin:9411/api/v2/spans
OTEL_SERVICE_NAME=monitoring-backend

# each agent service
OTEL_EXPORTER_ZIPKIN_ENDPOINT=http://zipkin:9411/api/v2/spans
OTEL_SERVICE_NAME=agent-<name>     # e.g. agent-web-01
```

New dependencies:

- Python agent: `opentelemetry-sdk`, `opentelemetry-exporter-zipkin`,
  `opentelemetry-instrumentation-grpc`
- Node backend: `@opentelemetry/sdk-node`, `@opentelemetry/exporter-zipkin`,
  `@opentelemetry/instrumentation-grpc`, `@opentelemetry/instrumentation-http`

## Consequences

- **This requires code instrumentation** — unlike Grafana (ADR-0002), which only
  reads the database, tracing means initialising the OTel SDK in `agent.py` and
  the backend entry point, and propagating context across gRPC. This is the main
  cost and the reason this is a heavier change than 0002.
- One extra container (`zipkin`), lighter than Grafana. Per-request span overhead
  is negligible at this volume (one push per agent per 60s).
- **No Zipkin auth means port `9411` must stay local.** Anyone who can reach the
  port sees all traces, with no login. Fine for localhost; a real deployment
  needs a reverse proxy or network restriction in front of it.
- In-memory storage loses traces on restart (accepted).
- Adds tracing dependencies to both the agent and backend images, slightly
  increasing build size and startup work.
- Because instrumentation is OTel-based, the "Zipkin vs. Grafana Tempo" choice
  stays open: moving to Tempo later (and viewing traces inside the existing
  Grafana from ADR-0002) would be an exporter/config change, not re-instrumentation.

## Relationship to other ADRs

- **ADR-0001 (Docker):** Zipkin is another Compose service in the same stack and
  network; agents and backend reach it by service name.
- **ADR-0002 (Grafana):** complementary, not overlapping. Grafana visualises
  **metrics** (aggregate resource usage from the DB); Zipkin visualises
  **traces** (single-request latency across services). They answer different
  questions and can run side by side. The deferred Zipkin-vs-Tempo decision noted
  in ADR-0002 is the one resolved here in favour of Zipkin, while keeping the
  OTel layer so Tempo remains a low-cost future option.
