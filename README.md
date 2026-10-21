# Edvak Forge — AI Front Desk Prototype

A review-first front desk agent for Maplewood Family Clinic's synthetic take-home data. The dashboard includes an inbox, patient directory, appointment desk, medication review, evaluation lab, audit and safety view, and settings. It classifies incoming requests, checks patient identity and clinic rules through MCP tools, prepares a staff-reviewed draft, and routes work to a human queue. It does not send messages, give clinical advice, approve prescriptions, or expose records to an unverified sender.

Use the Edvak Forge logo in the sidebar. For a guided walkthrough, take-home requirement checklist, live-message demo steps, and likely interview questions, see [DEMO_INTERVIEW_CHECKLIST.md](./DEMO_INTERVIEW_CHECKLIST.md).

## Architecture

```mermaid
flowchart LR
  Staff[Front-desk staff] --> UI[Vite inbox]
  UI --> API[Express API · server-only credentials]
  API --> Agent[Message orchestrator]
  Agent --> OR[OpenRouter model\noptional intent extraction]
  Agent --> MCPClient[MCP client]
  MCPClient -->|JSON-RPC over stdio| MCPServer[Standalone clinic MCP server]
  MCPServer --> Rules[Identity · refill · schedule · routing tools]
  Rules --> Data[Supabase server data]
  Rules -. local fallback .-> JSON[edvak_forge_data JSON]
  Agent --> Store[(Supabase · runs + staff queues)]
  Agent --> Draft[Draft + action trace]
  Draft --> Review[Staff reviews before any patient contact]
  Eval[Evaluation harness] --> Agent
  Eval --> Labels[40 synthetic expected outcomes]
```

OpenRouter only extracts intent and preferences. Deterministic code enforces identity, emergency replies, refill eligibility, clinic hours, provider leave, holidays, and appointment conflicts. The model never receives a tool that can approve a prescription or send a message. The MCP server can also run over stdio as a standalone tool server.

## Run locally

Requirements: Node.js 20 or newer and npm.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open `http://127.0.0.1:5173`. Without credentials, the app loads the provided JSON fixtures and uses the transparent local-rules mode. This mode is useful for reviewing the flow, not a substitute for a general medical language model.

To enable model-based intent extraction, set `OPENROUTER_API_KEY` and optionally `OPENROUTER_MODEL` in `.env`. The default model is `openai/gpt-4o-mini`. The API key stays on the Node server; it is not included in Vite's browser bundle. If the model request fails, processing falls back to local rules and records the mode in each result.

To read the already-seeded Supabase fixture instead of local JSON, set both `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env`. Use a server-side secret key only. Never use a Supabase secret/service-role key in a `VITE_*` variable or browser code. The server health endpoint reports the active data source and MCP connection. Local JSON remains the fallback when Supabase credentials are absent.

For a production build and local server:

```powershell
npm run build
npm start
```

Open `http://127.0.0.1:4317`.

## Supabase fixture

The project is seeded with synthetic data in `clinic_config`, `patients`, `medications`, `appointments`, `sample_messages`, and `evaluation_labels`. Processing a message with Supabase credentials also saves its draft/action record to `agent_runs`, its human routing reasons to `agent_queue_items`, and appointment changes to `appointments`. The Supabase connection made available to Codex is an administration connector; the running Node app needs its own server-only `SUPABASE_SECRET_KEY` (or legacy service role key) in `.env` to persist runtime actions. RLS is enabled and browser roles have no table access. To recreate the schema and seed it yourself:

```powershell
# Apply the SQL files in supabase/migrations with the Supabase CLI or SQL editor
npm run seed:supabase
```

The seed script reads the JSON fixtures and upserts `source_record` plus indexed fields. It requires `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env`.

## MCP tools

Run the clinic tool server over stdio with `npm run mcp`. It provides `set_current_message`, `find_patient`, `get_patient_medications`, `check_refill_eligibility`, `get_patient_appointments`, `find_appointment_slots`, `book_appointment`, `reschedule_appointment`, `cancel_appointment`, `route_message`, and `draft_reply`. Every patient-data or appointment mutation tool requires verified identity. Booking tools re-check conflicts at mutation time.

## Evaluation

```powershell
npm run evaluate
```

This processes all 40 messages against the take-home labels, prints a compact metric summary, and writes detailed per-message results to `reports/evaluation.json`. The report includes urgency accuracy, strict emergency recall, action exact match and micro F1, patient-candidate match, every missed emergency, and all detected `must_not` violations. The sample is intentionally tiny and synthetic; perfect performance on it does not establish clinical safety or generalization. Review false positives and negatives before changing policy rules.

Use **Run full evaluation** in the Evaluation Lab or inbox support panel. The free rules baseline makes no model calls. The OpenRouter option makes 40 model calls and may incur usage charges. Each individual message can also be processed from its detail pane. Staff review is persisted with the run; drafts and proposed actions always require staff review.

The baseline uses no OpenRouter calls. Before presenting results, run `npm run evaluate` and use the fresh report: the checked-in `reports/evaluation.json` currently disagrees with the narrative figures previously recorded here about the action result for `M020`. Resolve that mismatch and update the report/README together. Model-based evaluation remains an explicit, potentially billable action in the UI.

## Dashboard workflows

- **Inbox:** filter the 40 synthetic messages, analyze a message, inspect patient context and MCP tool traces, edit/save the proposed reply, mark it reviewed, and resolve its staff queue item. The response is never sent to a patient.
- **Patients:** search the synthetic directory and inspect profile context. Patient details are shown as clinic records; message processing separately verifies identity before revealing protected context.
- **Appointments:** search available times through MCP; book, reschedule, and cancel appointments. The MCP tools enforce identity, clinic hours, holidays, provider leave, slot duration, and conflicts. Successful changes persist in Supabase.
- **Medications:** inspect active fixture medication records and check refill policy through MCP. Eligible refills still require prescriber approval.
- **Evaluation Lab:** compare the deterministic rules baseline with OpenRouter model results across all 40 labeled messages. Review urgency, emergency recall, action accuracy, patient matching, and must-not violations.
- **Audit & Safety:** review outstanding staff queues and the prototype's safety boundaries.
- **Settings:** inspect clinic configuration and server-side integration status.
- **Test a new message:** submit fictional text to exercise the full analysis flow. It creates an agent run but does not add the raw custom text to the seeded message dataset or send any reply.

The Inbox header's **Test a message** button opens and scrolls to this form. After analysis, inspect the generated run, MCP tool trace, route, and unsent draft. Use a matching fictional patient contact from the Patients page only when demonstrating an identity-verified workflow.

The MCP client uses one stateful stdio session. The server serializes workflows that need that session so requests cannot overwrite each other's current-message identity context.

## Privacy and safety notes

- All included patient/message content is fictional synthetic data.
- The browser calls only this local/server API. Supabase's secret key and the OpenRouter key stay in Node environment variables.
- RLS is enabled on the fixture tables without anon/authenticated read policies. The server connects using a secret key.
- Patient name alone is only a possible match, never identity verification. No protected details are used or revealed without an exact contact, name-plus-DOB, or authorized caregiver match.
- Emergencies route immediately to a human. The draft only directs the sender to 911 or the nearest emergency department and says the clinic has been alerted.
- No prescription is approved or sent. All refill proposals are subject to provider approval.
- Appointment changes persist to the Supabase fixture when configured. Without Supabase credentials, changes persist to the ignored `.runtime/appointments.json` file and survive API/MCP requests and server restarts; the original JSON fixtures stay unchanged.
- Staff review state, edited drafts, agent runs, and routing queues persist through the server-only Supabase connection.
- The project is a take-home prototype, not a production medical system. It has no live SMS/email delivery, user authentication, or production authorization model. Use synthetic records only.

## Take-home implementation notes

- **Reused:** React, Vite, Express, the Supabase JS client, the official MCP TypeScript SDK, Tabler icons, and the provided synthetic clinic fixtures/labels.
- **Built for this prototype:** the front-desk workflow UI, Express orchestration API, clinic MCP tools and policy checks, OpenRouter intent-extraction adapter, local-rules fallback, Supabase fixture/run persistence, and 40-message evaluation harness.
- **Model and cost:** model selection is controlled by `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`). The Evaluation Lab reports the model/provider-reported cost when available; providers may omit cost. A 40-message model run can incur charges. The rules baseline is free and makes no model calls.
- **Known result and failure:** the checked-in evaluation report and previously recorded README narrative disagree about whether M020 has a strict action mismatch. Re-run the rules baseline and reconcile the reported figures before presenting them. The sample is only 40 fictional messages and does not establish clinical safety or generalization.
- **With another week:** broaden adversarial evaluation, harden tool failure handling and observability, run front-desk usability sessions, then design and review production authentication, authorization, tenant isolation, privacy, and communications integrations.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local API and Vite inbox |
| `npm run build` | Type-check the server and build the browser app |
| `npm start` | Serve the production build and API |
| `npm run evaluate` | Run the full benchmark and save `reports/evaluation.json` |
| `npm run mcp` | Start the standalone stdio MCP server |
| `npm run seed:supabase` | Upsert fixture data to the configured Supabase project |

