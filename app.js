/* ═══════════════════════════════════════════════════════════════════════
   app.js — CD Benefit Summary Extractor
   Works with Purchase AND Refinance Closing Disclosure PDFs.
   ═══════════════════════════════════════════════════════════════════════ */

/* ─── SAMPLE DATA (Refinance — LOAN # 1225090173-2) ──────────────────── */
const SAMPLE_DATA = {
  loanType: "Refinance", loanId: "1225090173-2",
  loanAmount: 450000, cashToClose: 14210.16,
  sectionA: 4176.16, sectionB: 2867.95, sectionC: 500, sectionE: 1435, lenderCredit: -13482,
  payoffLines: [
    { to: "Apple Card/Gs Bank USA",       amount: 1352   },
    { to: "Bank of America",              amount: 4269   },
    { to: "Citicards Cbna",               amount: 773    },
    { to: "Digital Fed Credit Uni",       amount: 2400   },
    { to: "Jpmcb Card (1)",               amount: 1658   },
    { to: "Jpmcb Card (2)",               amount: 2379   },
    { to: "Macys/Cbna",                   amount: 110    },
    { to: "United Whsle Mort (Mortgage)", amount: 448288 },
  ],
  principalReduction: 1023.54,
  homeownersInsurancePremium: 0, prepaidInterest: 1317.64, prepaidPropertyTaxes: 0,
  escrowHomeownersInsurance: 3234.96, escrowMortgageInsurance: 0,
  escrowPropertyTaxes: 3501.20, escrowCityPropertyTax: 0, aggregateAdjustment: -1078.29,
  // computed
  isPurchase: false,
  secD: 7544.11, totalCostOfLoan: 8979.11, benefitsCost: -4502.89,
  payoffAmount: 461229, excessPayoff: 12252.54,
  prepaid: 1317.64, escrows: 5657.87,
  escrowsPlusPrepaid: 6975.51, escrowsPlusPrepaidPlusExcess: 19228.05, benefitsEscrow: 5017.89,
};

/* ─── HELPERS ─────────────────────────────────────────────────────────── */
const fmt = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "$0.00";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? "-$" : "$") + s;
};
const negClass = (n) => (n < 0 ? "negative" : "");
const posClass = (n) => (n > 0 ? "positive" : "");

/* ─── RENDER ──────────────────────────────────────────────────────────── */
function renderResults(d) {
  const isPurchase = d.isPurchase || !d.payoffLines || d.payoffLines.length === 0;

  const html = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:10px;">
      <div class="file-pill">
        <span class="dot"></span>
        ${d.fileName || "closing-disclosure.pdf"}
        ${d.loanId ? " · LOAN #" + d.loanId : ""}
        <span style="margin-left:8px;padding:2px 10px;border-radius:4px;font-size:10px;font-weight:600;
          background:${isPurchase ? "rgba(240,208,96,0.15)" : "rgba(184,240,74,0.12)"};
          color:${isPurchase ? "#f0d060" : "#b8f04a"}">
          ${isPurchase ? "PURCHASE" : "REFINANCE"}
        </span>
      </div>
      <button class="btn-reset" onclick="resetApp()">↺ RESET</button>
    </div>

    <!-- ══ PART 1 ══════════════════════════════════════════════════════ -->
    <div class="section-block">
      <div class="section-header">
        <span class="section-num">PART 01</span>
        <span class="section-title">Savings Depicted by Cost</span>
        <span class="section-desc">How Benefits Received</span>
      </div>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">
        Extracted from <strong style="color:var(--text)">Sections A, B, C, E</strong>
        and <strong style="color:var(--text)">Section J</strong> (Lender Credits).
      </p>

      <div class="data-grid">
        <div class="data-row">
          <div class="row-label"><span class="code">SEC A</span> Origination Charges</div>
          <div class="row-value">${fmt(d.sectionA)}</div>
        </div>
        <div class="data-row">
          <div class="row-label"><span class="code">SEC B</span> Services You Cannot Shop For</div>
          <div class="row-value">${fmt(d.sectionB)}</div>
        </div>
        <div class="data-row">
          <div class="row-label"><span class="code">SEC C</span> Services You Can Shop For</div>
          <div class="row-value">${fmt(d.sectionC)}</div>
        </div>
        <div class="data-row subtotal">
          <div class="row-label">Section D = A + B + C</div>
          <div class="row-value">${fmt(d.secD)}</div>
        </div>
        <div class="data-row">
          <div class="row-label"><span class="code">SEC E</span> Taxes and Other Government Fees</div>
          <div class="row-value">${fmt(d.sectionE)}</div>
        </div>
        <div class="data-row subtotal">
          <div class="row-label">Total Cost of Loan = D + E</div>
          <div class="row-value">${fmt(d.totalCostOfLoan)}</div>
        </div>
        <div class="data-row">
          <div class="row-label">
            <span class="code">SEC J</span> Lender Credit
            <em style="font-size:11px;color:var(--text-dim);font-style:normal;">(negative = saving)</em>
          </div>
          <div class="row-value ${negClass(d.lenderCredit)}">${fmt(d.lenderCredit)}</div>
        </div>
        <div class="data-row total-row">
          <div class="row-label">Benefits (Cost) = Total Cost of Loan + Lender Credit</div>
          <div class="row-value big ${d.benefitsCost <= 0 ? "positive" : "negative"}">${fmt(d.benefitsCost)}</div>
        </div>
      </div>

      <div class="formula-trace">Benefits (Cost) = <span class="hl">${fmt(d.totalCostOfLoan)}</span> + (<span class="hl">${fmt(d.lenderCredit)}</span>) = <span class="hl">${fmt(d.benefitsCost)}</span></div>

      <div class="benefit-card" style="margin-top:20px;">
        <div class="benefit-label">// Part 1 Result — Benefits (Cost)</div>
        <div class="benefit-formula">Total Cost of Loan + Lender Credits</div>
        <div class="benefit-amount ${d.benefitsCost <= 0 ? "saving" : "cost"}">${fmt(d.benefitsCost)}</div>
        <div class="benefit-note">${d.benefitsCost <= 0
          ? "✓ Negative — borrower is saving money via lender credits."
          : "⚠ Positive — net cost to borrower (no or partial lender credit)."}</div>
      </div>
    </div>

    <div class="divider"></div>

    <!-- ══ PART 2 ══════════════════════════════════════════════════════ -->
    <div class="section-block">
      <div class="section-header">
        <span class="section-num">PART 02</span>
        <span class="section-title">Savings Depicted by Escrows &amp; Payoff</span>
      </div>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">
        Extracted from <strong style="color:var(--text)">Page 1</strong>,
        <strong style="color:var(--text)">Page 3</strong> (Payoffs),
        <strong style="color:var(--text)">Sections F &amp; G</strong>.
      </p>

      ${isPurchase ? `
      <div style="background:rgba(240,208,96,0.07);border:1px solid rgba(240,208,96,0.2);
                  border-radius:10px;padding:12px 18px;margin-bottom:20px;font-size:13px;color:#f0d060;line-height:1.6;">
        ℹ <strong>Purchase Loan</strong> — no Payoff lines exist on Page 3.
        Payoff Amount = $0.00 and Excess Payoff = $0.00.
      </div>` : `
      <p style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted);
                letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">
        Payoff Lines (Page 3 — all "Payoff to…" entries summed)
      </p>
      <div class="data-grid" style="margin-bottom:16px;">
        ${(d.payoffLines || []).map(p => `
        <div class="data-row">
          <div class="row-label">Payoff to ${p.to}</div>
          <div class="row-value">${fmt(p.amount)}</div>
        </div>`).join("")}
        <div class="data-row subtotal">
          <div class="row-label">Payoff Amount (Total)</div>
          <div class="row-value">${fmt(d.payoffAmount)}</div>
        </div>
      </div>`}

      <div class="data-grid">
        <div class="data-row">
          <div class="row-label"><span class="code">P.1</span> Loan Amount</div>
          <div class="row-value">${fmt(d.loanAmount)}</div>
        </div>
        <div class="data-row">
          <div class="row-label"><span class="code">P.3</span> Payoff Amount</div>
          <div class="row-value">${fmt(d.payoffAmount)}</div>
        </div>
        <div class="data-row">
          <div class="row-label"><span class="code">P.3</span> Principal Reduction to Consumer</div>
          <div class="row-value">${fmt(d.principalReduction)}</div>
        </div>
        <div class="data-row subtotal">
          <div class="row-label">
            Excess Amount over Payoff
            ${isPurchase ? '<em style="font-size:11px;color:var(--text-dim);font-style:normal;">(purchase = $0)</em>' : "= Payoff + Principal Reduction − Loan Amount"}
          </div>
          <div class="row-value ${negClass(d.excessPayoff)}">${fmt(d.excessPayoff)}</div>
        </div>

        <div class="data-row">
          <div class="row-label"><span class="code">SEC F</span> Homeowner's Insurance Premium</div>
          <div class="row-value">${fmt(d.homeownersInsurancePremium)}</div>
        </div>
        <div class="data-row">
          <div class="row-label"><span class="code">SEC F</span> Prepaid Interest</div>
          <div class="row-value">${fmt(d.prepaidInterest)}</div>
        </div>
        <div class="data-row">
          <div class="row-label"><span class="code">SEC F</span> Property Taxes (prepaid)</div>
          <div class="row-value">${fmt(d.prepaidPropertyTaxes)}</div>
        </div>
        <div class="data-row subtotal">
          <div class="row-label">Prepaid (Section F) = HO Insurance + Interest + Property Taxes</div>
          <div class="row-value">${fmt(d.prepaid)}</div>
        </div>

        <div class="data-row">
          <div class="row-label"><span class="code">SEC G</span> 01 Homeowner's Insurance</div>
          <div class="row-value">${fmt(d.escrowHomeownersInsurance)}</div>
        </div>
        <div class="data-row">
          <div class="row-label"><span class="code">SEC G</span> 02 Mortgage Insurance</div>
          <div class="row-value">${fmt(d.escrowMortgageInsurance)}</div>
        </div>
        <div class="data-row">
          <div class="row-label"><span class="code">SEC G</span> 03 Property Taxes</div>
          <div class="row-value">${fmt(d.escrowPropertyTaxes)}</div>
        </div>
        <div class="data-row">
          <div class="row-label"><span class="code">SEC G</span> 04 City Property Tax</div>
          <div class="row-value">${fmt(d.escrowCityPropertyTax)}</div>
        </div>
        <div class="data-row">
          <div class="row-label">
            <span class="code">SEC G</span> Aggregate Adjustment
            <em style="font-size:11px;color:var(--text-dim);font-style:normal;">(often negative)</em>
          </div>
          <div class="row-value ${negClass(d.aggregateAdjustment)}">${fmt(d.aggregateAdjustment)}</div>
        </div>
        <div class="data-row subtotal">
          <div class="row-label">Escrows (Section G) = G01+G02+G03+G04+Agg.Adj</div>
          <div class="row-value">${fmt(d.escrows)}</div>
        </div>

        <div class="data-row subtotal">
          <div class="row-label">Escrows + Prepaid = G + F</div>
          <div class="row-value">${fmt(d.escrowsPlusPrepaid)}</div>
        </div>
        <div class="data-row subtotal">
          <div class="row-label">Escrows + Prepaid + Excess Payoff</div>
          <div class="row-value">${fmt(d.escrowsPlusPrepaidPlusExcess)}</div>
        </div>
        <div class="data-row">
          <div class="row-label"><span class="code">P.1</span> Cash to Close</div>
          <div class="row-value">${fmt(d.cashToClose)}</div>
        </div>
        <div class="data-row total-row">
          <div class="row-label">Benefits (Escrow) = (Escrows + Prepaid + Excess Payoff) − Cash to Close</div>
          <div class="row-value big ${d.benefitsEscrow >= 0 ? "positive" : "negative"}">${fmt(d.benefitsEscrow)}</div>
        </div>
      </div>

      <div class="formula-trace">Benefits (Escrow) = <span class="hl">${fmt(d.escrowsPlusPrepaidPlusExcess)}</span> − <span class="hl">${fmt(d.cashToClose)}</span> = <span class="hl">${fmt(d.benefitsEscrow)}</span></div>

      <div class="benefit-card" style="margin-top:20px;">
        <div class="benefit-label">// Part 2 Result — Benefits (Escrow)</div>
        <div class="benefit-formula">(Escrows + Prepaid + Excess Payoff) − Cash to Close</div>
        <div class="benefit-amount ${d.benefitsEscrow >= 0 ? "saving" : "cost"}">${fmt(d.benefitsEscrow)}</div>
        <div class="benefit-note">${d.benefitsEscrow >= 0
          ? "✓ Positive — escrows & payoffs exceed cash to close."
          : "⚠ Cash to close exceeds escrow & payoff benefits."}</div>
      </div>
    </div>

    <div class="divider"></div>

    <!-- ══ ASSUMPTIONS ══════════════════════════════════════════════════ -->
    <div class="assumptions">
      <h3>// Assumptions &amp; Notes</h3>
      <ul>
        <li>Loan type: <strong style="color:var(--text)">${d.loanType || "Unknown"}</strong>.
          ${isPurchase
            ? "Purchase loans have no Payoff lines — Excess Payoff is $0 by definition."
            : "Refinance: Payoff Amount sums all \"Payoff to…\" lines on Page 3. Principal Reduction is separate."}</li>
        <li>Section A uses borrower-paid at-closing total only. "Paid by Others" amounts excluded.</li>
        <li>Section E uses borrower-paid Recording Fees only. Seller-paid Transfer Taxes excluded.</li>
        <li>Lender Credit (${fmt(d.lenderCredit)}) is negative. A negative Benefits(Cost) means the borrower saves money.</li>
        <li>Aggregate Adjustment (${fmt(d.aggregateAdjustment)}) reduces Section G total as it is negative per CD convention.</li>
        <li>All blank or missing fields default to $0.00.</li>
      </ul>
    </div>`;

  const el = document.getElementById("results");
  el.innerHTML = html;
  el.style.display = "block";
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ─── UI STATE ────────────────────────────────────────────────────────── */
function resetApp() {
  document.getElementById("results").style.display = "none";
  document.getElementById("results").innerHTML = "";
  document.getElementById("upload-area").style.display = "block";
  document.getElementById("error-box").style.display = "none";
  document.getElementById("file-input").value = "";
}

function showLoading(msg) {
  document.getElementById("loading").style.display = "block";
  document.getElementById("loading-text").textContent = msg || "Processing...";
  document.getElementById("upload-area").style.display = "none";
  document.getElementById("error-box").style.display = "none";
}

function hideLoading() {
  document.getElementById("loading").style.display = "none";
}

function showError(msg) {
  const el = document.getElementById("error-box");
  el.textContent = "⚠ " + msg;
  el.style.display = "block";
  document.getElementById("upload-area").style.display = "block";
}

/* ─── API CALL ────────────────────────────────────────────────────────── */
async function extractViaAPI(file) {
  const formData = new FormData();
  formData.append("pdf", file);

  let response;
  try {
    response = await fetch("/api/extract", { method: "POST", body: formData });
  } catch {
    throw new Error(
      "Cannot reach server. Make sure you ran 'node server.js' and opened http://localhost:3000"
    );
  }

  const rawText = await response.text();

  if (!rawText || rawText.trim() === "") {
    throw new Error(`Server returned empty response (HTTP ${response.status}). Check terminal.`);
  }

  let result;
  try {
    result = JSON.parse(rawText);
  } catch {
    throw new Error(`Server returned non-JSON (HTTP ${response.status}). Check terminal.`);
  }

  if (!response.ok || !result.success) {
    throw new Error(result.error || `Server error (HTTP ${response.status})`);
  }

  return result.data;
}

/* ─── PROCESS FILE ────────────────────────────────────────────────────── */
async function processFile(file) {
  showLoading("Extracting values from PDF via AI… (15–30 sec)");

  // Rotate loading messages so the user knows it's working
  const messages = [
    "Extracting values from PDF via AI… (15–30 sec)",
    "Reading loan costs and escrow sections…",
    "Identifying loan type and payoff lines…",
    "Computing benefit summary…",
  ];
  let i = 0;
  const timer = setInterval(() => {
    i = (i + 1) % messages.length;
    const el = document.getElementById("loading-text");
    if (el) el.textContent = messages[i];
  }, 6000);

  try {
    const data = await extractViaAPI(file);
    clearInterval(timer);
    data.fileName = file.name;
    hideLoading();
    renderResults(data);
  } catch (err) {
    clearInterval(timer);
    hideLoading();
    showError(err.message);
  }
}

/* ─── EVENTS ──────────────────────────────────────────────────────────── */
document.getElementById("btn-sample").addEventListener("click", () => {
  showLoading("Loading sample Closing Disclosure…");
  setTimeout(() => { hideLoading(); renderResults(SAMPLE_DATA); }, 600);
});

document.getElementById("file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.type !== "application/pdf") { showError("Please upload a PDF file."); return; }
  await processFile(file);
});

const dropzone = document.getElementById("dropzone");
dropzone.addEventListener("dragover",  (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); });
dropzone.addEventListener("dragleave", ()  => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (!file || file.type !== "application/pdf") { showError("Please drop a PDF file."); return; }
  await processFile(file);
});