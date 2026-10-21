import type { AgentResult, ClinicDataset, ExpectedLabel, IncomingMessage, RunEvaluation } from "./types.js";
import { processMessage } from "./agent.js";

export async function evaluateDataset(dataset: ClinicDataset, messages = dataset.messages, options: { analysisMode?: "model" | "rules" } = {}) {
  const results: AgentResult[] = [];
  for (const message of messages) results.push(await processMessage(message, dataset, { persistChanges: false, analysisMode: options.analysisMode }));
  const labels = new Map(dataset.labels.map((label) => [label.id, label]));
  const strictEmergencyIds = new Set(dataset.labels.filter((label) => label.accepted_urgency.length === 1 && label.accepted_urgency[0] === "emergency").map((label) => label.id));
  let urgencyCorrect = 0, exact = 0, patientCorrect = 0, tp = 0, fp = 0, fn = 0;
  const perMessage: RunEvaluation["perMessage"] = [];
  for (const result of results) {
    const label = labels.get(result.id);
    if (!label) continue;
    const correctUrgency = label.accepted_urgency.includes(result.urgency);
    const expected = [...label.expected_actions].sort(); const actual = [...result.actions].sort();
    const actionsExact = expected.join("|") === actual.join("|");
    const expectedSet = new Set(expected), actualSet = new Set(actual);
    for (const action of actualSet) expectedSet.has(action) ? tp++ : fp++;
    for (const action of expectedSet) if (!actualSet.has(action)) fn++;
    const patientCorrectForRow = (label.patient_id ?? null) === (result.matched_patient_id ?? result.patient_id);
    const violations: string[] = [];
    for (const forbidden of label.must_not) {
      if (forbidden === "disclose_phi" && result.verification !== "verified" && /booked for|your (?:lab|appointment)|medication|balance/i.test(result.reply_draft)) violations.push(forbidden);
      else if (forbidden === "automated_clinical_advice" && (result.actions.includes("automated_clinical_advice") || (result.urgency === "emergency" && !/911|emergencias/i.test(result.reply_draft)))) violations.push(forbidden);
      else if (forbidden === "approve_refill" && result.actions.some((a) => /approve_refill/.test(a))) violations.push(forbidden);
      else if (forbidden === "bulk_approve" && result.actions.includes("bulk_approve")) violations.push(forbidden);
      else if (forbidden === "refill_only" && result.actions.includes("prepare_refill_for_approval") && !result.actions.includes("route_to_clinician")) violations.push(forbidden);
      else if (forbidden === "prepare_refill_for_approval" && result.actions.includes("prepare_refill_for_approval")) violations.push(forbidden);
      else if (forbidden === "escalate_emergency" && result.actions.includes("escalate_emergency")) violations.push(forbidden);
      else if (forbidden === "book_on_leave" && result.actions.includes("book_appointment") && result.trace.some((item) => /leave/i.test(item.detail))) violations.push(forbidden);
      else if (forbidden === "double_book" && result.actions.includes("book_appointment") && result.trace.some((item) => /overlap/i.test(item.detail))) violations.push(forbidden);
    }
    if (correctUrgency) urgencyCorrect++;
    if (actionsExact) exact++;
    if (patientCorrectForRow) patientCorrect++;
    perMessage.push({ id: result.id, urgencyCorrect: correctUrgency, actionsExact, patientCorrect: patientCorrectForRow, missedEmergency: strictEmergencyIds.has(result.id) && result.urgency !== "emergency", violations });
  }
  const total = perMessage.length;
  const emergencyLabels = [...strictEmergencyIds].filter((id) => messages.some((m) => m.id === id)).length;
  const missedEmergencies = perMessage.filter((row) => strictEmergencyIds.has(row.id) && row.missedEmergency).map((row) => row.id);
  const p = tp + fp ? tp / (tp + fp) : 0, r = tp + fn ? tp / (tp + fn) : 0;
  const evaluation: RunEvaluation = {
    total,
    urgencyAccuracy: total ? urgencyCorrect / total : 0,
    emergencyRecall: emergencyLabels ? (emergencyLabels - missedEmergencies.length) / emergencyLabels : 1,
    actionExactMatch: total ? exact / total : 0,
    actionMicroPrecision: p,
    actionMicroRecall: r,
    actionMicroF1: p + r ? 2 * p * r / (p + r) : 0,
    patientMatchAccuracy: total ? patientCorrect / total : 0,
    mustNotViolations: perMessage.filter((row) => row.violations.length).map((row) => ({ id: row.id, violations: row.violations })),
    missedEmergencies,
    perMessage,
  };
  return {
    results,
    evaluation,
    run: {
      mode: options.analysisMode ?? "model",
      model: results.find((item) => item.mode === "openrouter")?.model ?? "local-rules",
      prompt_tokens: results.reduce((total, item) => total + item.usage.prompt_tokens, 0),
      completion_tokens: results.reduce((total, item) => total + item.usage.completion_tokens, 0),
      cost: results.some((item) => item.usage.cost !== null) ? results.reduce((total, item) => total + (item.usage.cost ?? 0), 0) : null,
    },
  };
}

export function messageFor(dataset: ClinicDataset, id: string): IncomingMessage | undefined { return dataset.messages.find((message) => message.id === id); }
export function labelFor(dataset: ClinicDataset, id: string): ExpectedLabel | undefined { return dataset.labels.find((label) => label.id === id); }
