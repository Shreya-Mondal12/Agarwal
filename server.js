require("dotenv").config();
const express = require("express");
const multer  = require("multer");
const fetch   = require("node-fetch");
const cors    = require("cors");
const path    = require("path");

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log("➡️", req.method, req.url);
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

/* ── Health ──────────────────────────────────────────────────────────────── */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", apiKeyLoaded: !!(process.env.ANTHROPIC_API_KEY || "").trim() });
});

/* ── Extraction endpoint ─────────────────────────────────────────────────── */
app.post("/api/extract", (req, res) => {
  upload.single("pdf")(req, res, (err) => {
    if (err) return res.status(400).json({ error: "Upload error: " + err.message });
    handleExtract(req, res).catch((e) => {
      if (!res.headersSent) res.status(500).json({ error: e.message });
    });
  });
});

/* Static files LAST so API routes are matched first */
app.use(express.static(path.join(__dirname)));

/* ── Main logic ──────────────────────────────────────────────────────────── */
async function handleExtract(req, res) {
  if (!req.file) return res.status(400).json({ error: "No file received." });
  console.log(`\n[1] File: "${req.file.originalname}" | ${(req.file.size/1024).toFixed(1)} KB`);

  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY missing from .env" });

  const base64PDF = req.file.buffer.toString("base64");

  // ── STEP 1: Extract raw field values from PDF ─────────────────────────────
  const EXTRACT_PROMPT = `You are a precise financial document parser for CFPB Closing Disclosure (CD) forms.

Read ALL pages carefully and extract the exact values listed below.
Return ONLY a raw JSON object — no markdown, no code fences, no explanation.

CRITICAL RULES — read before extracting:
1. loanType: "Purchase" if Purpose field says Purchase, otherwise "Refinance"
2. sectionA: Section A "Origination Charges" — use the TOTAL shown for Section A, borrower-paid at-closing column only. Do NOT include "Paid by Others" column amounts.
3. sectionB: Section B total — borrower-paid (at-closing + before-closing combined is shown as the section header total). Use that header total.
4. sectionC: Section C total — same rule, use the section header total.
5. sectionE: Section E "Taxes and Other Government Fees" — borrower-paid total only (Recording Fees borrower column + any Transfer Tax in the borrower column). Seller-paid Transfer Tax is NOT included.
6. lenderCredit: From Section J or Page 1 "Lender Credits" line — as a NEGATIVE number. If "$0" or blank, use 0.
7. payoffLines: ONLY if this is a Refinance loan AND Page 3 has a "Payoffs and Payments" table with "Payoff to..." rows in the BORROWER section. For Purchase loans, return []. Do NOT use seller payoff lines.
8. principalReduction: "Principal Reduction to Consumer" from the Payoffs table. 0 if absent.
9. homeownersInsurancePremium: Section F item 01 — the dollar AMOUNT (not monthly rate). 0 if blank.
10. prepaidInterest: Section F item 03 — the dollar amount. 0 if blank.
11. prepaidPropertyTaxes: Section F item 04 — the dollar amount. 0 if blank.
12. escrowHomeownersInsurance: Section G item 01 — the TOTAL amount (monthly × months). 0 if blank.
13. escrowPropertyTaxes: Section G item 03 — the TOTAL amount. 0 if blank.
14. aggregateAdjustment: Section G "Aggregate Adjustment" — as NEGATIVE number if shown with minus sign. 0 if absent.
15. cashToClose: The "Cash to Close" dollar amount on Page 1 under "Costs at Closing". Use the borrower's final number.

Return this exact JSON structure:
{
  "loanType": "<Purchase or Refinance>",
  "loanId": "<Loan ID string, or empty string>",
  "loanAmount": <number>,
  "cashToClose": <number>,
  "sectionA": <number>,
  "sectionB": <number>,
  "sectionC": <number>,
  "sectionE": <number>,
  "lenderCredit": <number, negative or 0>,
  "payoffLines": [{"to": "<name>", "amount": <number>}],
  "principalReduction": <number>,
  "homeownersInsurancePremium": <number>,
  "prepaidInterest": <number>,
  "prepaidPropertyTaxes": <number>,
  "escrowHomeownersInsurance": <number>,
  "escrowMortgageInsurance": <number>,
  "escrowPropertyTaxes": <number>,
  "escrowCityPropertyTax": <number>,
  "aggregateAdjustment": <number, negative or 0>
}`;

  console.log("[2] Calling Claude for extraction...");
  const extractText = await callClaude(apiKey, base64PDF, EXTRACT_PROMPT);
  return res.status(200).json({
  success: false,
  error: "Extraction failed due to format issues. Please retry."
});

  console.log(`[3] Raw extract response:\n${extractText.slice(0, 1000)}`);

  let extracted;
  try {
    extracted = JSON.parse(stripFences(extractText));
  } catch (e) {
    return res.status(502).json({ error: "Could not parse extraction JSON: " + e.message, raw: extractText.slice(0, 300) });
  }

  console.log(`[4] Extracted: loanType=${extracted.loanType}, loanId=${extracted.loanId}`);
  console.log(`    sectionA=${extracted.sectionA}, B=${extracted.sectionB}, C=${extracted.sectionC}, E=${extracted.sectionE}`);
  console.log(`    lenderCredit=${extracted.lenderCredit}, payoffLines=${JSON.stringify(extracted.payoffLines)}`);
  console.log(`    F: HO=${extracted.homeownersInsurancePremium}, Int=${extracted.prepaidInterest}, Tax=${extracted.prepaidPropertyTaxes}`);
  console.log(`    G: HO=${extracted.escrowHomeownersInsurance}, PT=${extracted.escrowPropertyTaxes}, AggAdj=${extracted.aggregateAdjustment}`);
  console.log(`    loanAmount=${extracted.loanAmount}, cashToClose=${extracted.cashToClose}`);

  // ── STEP 2: Compute benefit summary server-side (no second Claude call needed) ──
  const isPurchase = !extracted.payoffLines || extracted.payoffLines.length === 0;

  const n = (v) => parseFloat(v) || 0;

  // Part 1
  const secD            = n(extracted.sectionA) + n(extracted.sectionB) + n(extracted.sectionC);
  const totalCostOfLoan = secD + n(extracted.sectionE);
  const benefitsCost    = totalCostOfLoan + n(extracted.lenderCredit);

  // Part 2
  const payoffAmount = (extracted.payoffLines || []).reduce((s, p) => s + n(p.amount), 0);
  // For purchase loans, excess payoff is 0 (formula only applies to refinances)
  const excessPayoff = isPurchase ? 0 : (payoffAmount + n(extracted.principalReduction) - n(extracted.loanAmount));

  const prepaid =
    n(extracted.homeownersInsurancePremium) +
    n(extracted.prepaidInterest) +
    n(extracted.prepaidPropertyTaxes);

  const escrows =
    n(extracted.escrowHomeownersInsurance) +
    n(extracted.escrowMortgageInsurance) +
    n(extracted.escrowPropertyTaxes) +
    n(extracted.escrowCityPropertyTax) +
    n(extracted.aggregateAdjustment);

  const escrowsPlusPrepaid           = escrows + prepaid;
  const escrowsPlusPrepaidPlusExcess = escrowsPlusPrepaid + excessPayoff;
  const benefitsEscrow               = escrowsPlusPrepaidPlusExcess - n(extracted.cashToClose);

  const computed = {
    isPurchase,
    secD:                          round2(secD),
    totalCostOfLoan:               round2(totalCostOfLoan),
    benefitsCost:                  round2(benefitsCost),
    payoffAmount:                  round2(payoffAmount),
    excessPayoff:                  round2(excessPayoff),
    prepaid:                       round2(prepaid),
    escrows:                       round2(escrows),
    escrowsPlusPrepaid:            round2(escrowsPlusPrepaid),
    escrowsPlusPrepaidPlusExcess:  round2(escrowsPlusPrepaidPlusExcess),
    benefitsEscrow:                round2(benefitsEscrow),
  };

  console.log(`[5] ✅ Computed: benefitsCost=${computed.benefitsCost}, benefitsEscrow=${computed.benefitsEscrow}`);
  return res.json({ success: true, data: { ...extracted, ...computed } });
}

/* ── Claude API helper ───────────────────────────────────────────────────── */
async function callClaude(apiKey, base64PDF, prompt) {
  const content = [];
  if (base64PDF) {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64PDF } });
  }
  content.push({ type: "text", text: prompt });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-opus-20240229",
      max_tokens: 2000,
      messages:   [{ role: "user", content }],
    }),
  });

  const rawBody = await res.text();
  console.log(`   Anthropic HTTP ${res.status}`);

  if (!res.ok) {
    let msg = `Anthropic error ${res.status}`;
    try { msg = JSON.parse(rawBody).error?.message || msg; } catch {}
    throw new Error(msg);
  }

  const envelope = JSON.parse(rawBody);
  return (envelope.content || [])
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();
}

/* ── Utilities ───────────────────────────────────────────────────────────── */
function stripFences(text) {
  return text
    .replace(/^```json[\r\n]*/i, "")
    .replace(/^```[\r\n]*/,      "")
    .replace(/[\r\n]*```$/,      "")
    .trim();
}

function round2(n) { return Math.round(n * 100) / 100; }

/* ── Start ───────────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  console.log(`\n✅  Server → http://localhost:${PORT}`);
  console.log(`   API key: ${key ? `LOADED ✓ (${key.slice(0,20)}...)` : "MISSING ✗ — add to .env"}\n`);
});