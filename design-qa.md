# Design QA — Edvak Forge front desk

## Sources and capture

- Selected visual style: `C:\Users\Asus\.codex\generated_images\01a15e2d-6443-7071-87f4-eedcffce5e21\exec-f8bf0fa4-992a-4ec4-9251-00572efb6489.png` (1487 × 1058 px).
- Dashboard structure: `C:\Users\Asus\AppData\Local\Temp\codex-clipboard-f58470dc-d14c-451a-b6f9-42beb280d2a0.png` (1536 × 1024 px).
- Rendered implementation: `C:\Users\Asus\Documents\GitHub\edvakehr\design-qa-dashboard.png` (1487 × 1058 px; 1487 × 1058 CSS px; DPR 1).
- Full-view comparisons: `design-qa-comparison.png` (selected style) and `design-qa-structure-comparison.png` (dashboard structure).
- Viewport/state: 1487 × 1058 CSS px, desktop, light content theme; inbox with synthetic emergency message M003 selected, verified, analyzed, and awaiting human review. Emergency reply is unsent; clinician queue remains open. The structure reference was centered-cropped to 1487 px and padded by 34 px at the bottom to align the comparison canvas without scaling.
- Focused-region comparison: not needed; the full-view comparison shows the inbox, analysis workspace, owl assistant, and all four supporting workflow cards together.

## Findings

- No actionable P0, P1, or P2 visual defects remain.
- The final layout keeps urgent messages at the top, fits the inbox panels to their grid, and places the appointment, refill, evaluation, and test-message cards below them without overlap.
- The selected owl character and the dark navigation / metrics / lower-card structure from the two references are present. The take-home fixture date (Nov 9, 2026) is retained.

## Iteration history

1. First implementation capture showed inbox columns expanding to the full 40-message list height and covering the supporting cards. Constrained the inbox grid row and panel minimum heights. The final capture shows bounded, scrollable inbox panels and a clear lower-card row.
2. Processing a message briefly inserted an incomplete result object, which could crash the assistant panel while the request was running. Kept processing state separate from saved result data and guarded optional action/tool arrays. Fresh-browser processing now completes without console errors, including when OpenRouter falls back to local rules.
3. Urgent messages initially remained in timestamp order. Sorted emergency candidates ahead of routine messages; the final capture shows the emergency messages first.

## Follow-up polish

- The selected style reference uses a white navigation rail and more inline clinical-analysis detail. This implementation follows the dark rail and denser workflow structure of the second reference, with patient context and MCP traces available in tabs.
- The live model request is currently blocked by OpenRouter HTTP 402. The app clearly labels the local-rules fallback; adding provider credits will enable model analysis.

## Verification

- `npm run build`: passed.
- Navigation: Inbox, AI Agent, Patients, Appointments, Medications, Evaluation Lab, Audit & Safety, and Settings all rendered.
- Safety workflow: emergency analysis, verified patient context, four MCP tool calls, timeline, unsent 911 / emergency-department draft, and clinician routing were confirmed.
- Read-only MCP workflows: appointment slot search returned 20 options; refill policy returned eligible for the matching synthetic medication.
- Rules baseline (40 synthetic messages): urgency accuracy 100%; strict emergency recall 100%; action exact match 97.5%; action micro F1 97.9%; patient matching 100%; must-not violations 0. No OpenRouter calls or evaluation writes were used for this baseline.
- Fresh-browser console: no errors after the fixes.
- OpenRouter: key is present, but a routine request returned HTTP 402 and used the deterministic local-rules fallback.

**final result: passed**
