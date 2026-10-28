# washnodes

Washer inventory per node, the hold lifecycle with a one-orbit TTL, cycle start on `pod.delivered`, completion by
v1 polling or v2 callback, retry of faulted cycles on another washer, and maintenance flags from triage. The port is
`WashnodesService` and `HoldStore` in `@sudsnik/contracts/services/washnodes`; what the service owes is
`docs/system-spec.md` §9.5.

Layout is hexagonal: `src/domain/` (rules, no imports from infra), `src/ports/` (what the use cases need), `src/adapters/`
(firmware `v1.ts` and `v2.ts`, Drizzle `db/schema.ts` and the repositories over it, the SQLite hold store, the outbox
publisher), `src/app/` (use cases, cycle flow, reports, the composition root `compose.ts`), `src/http/routes.ts`,
`src/handlers/` (one per consumed topic), `src/runtime.ts` (how a directory-scanned handler reaches the app), and
`src/variants/sqlite/`, which is the durable storage `compose.ts` is handed. `src/index.ts` selects it.

Routes: `POST /holds`, `POST /holds/:holdId/release`, `POST /holds/:holdId/start`, `GET /nodes/:nodeId`, and
`POST /callbacks/washer`, which is where firmware v2 reports a cycle.

The hold store is SQLite-backed and keyed by hold id (`src/adapters/db/holdStore.ts`): acquisition, release, consume,
and expiry run in transactions, release and consume check the expected version, and holds survive process restarts.
Inventory, cycles, nodes, reports and the dedupe keys are indexed SQLite reads through `src/adapters/db/`.

## Tables (`washnodes.sqlite`, `migrations/0001_inventory.sql`, `migrations/0002_one_held_hold_per_washer.sql`)

The migration carries the schema only. `createApp` seeds nodes and washers from canon (`NODES`, `WASHERS_PER_NODE`,
`NODE_FIRMWARE`, `washerId`) through `src/adapters/db/fleet.ts` before reporting ready: it inserts what is missing and
leaves existing rows alone, so the fleet follows a canon change with no migration.

| Table | Holds |
|---|---|
| `washers` | One row per washer canon names: node, index in node, firmware, `state` (idle, held, washing, faulted), `maintenance`, current `hold_id` |
| `nodes` | `in_contact` from the last poll or callback outcome |
| `holds` | Durable hold rows with one active held hold per washer, `version` for optimistic concurrency, and `firmware_ref` (v1 token or v2 hold id) |
| `cycles` | One row per firmware cycle: order, washer, `attempt`, outcome, `retry_pending` |
| `washer_reports` | Anomaly reports and their triage action against the washer that washed the order |
| `handled_events`, `washer_callbacks` | Dedupe keys: envelope ids and washer callback ids |
| `outbox` | Events written with the state they describe (`infra/queue`) |

## Timers on the simulated clock

Every minute: expire holds past `expiresAt`, return faulted washers after five minutes, retry pending faulted cycles.
Every five minutes: poll every running v1 cycle. Every orbit: read back every running v2 cycle older than an hour.

That orbit sweep is what recovers a `washer-v2` completion the relay held while the node it came from was dark.

A hold that nothing will move is released by hand per `docs/runbooks/release-hold.md`.
