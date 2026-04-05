#!/usr/bin/env python3
"""
cd_benefit_summary.py
─────────────────────
Closing Disclosure Benefit Summary Extractor

Reads a Closing Disclosure PDF, extracts the required values via
the Anthropic Claude API, and prints a formatted Benefit Summary
with two parts:
  Part 1 — Savings Depicted by Cost (How Benefits Received)
  Part 2 — Savings Depicted by Escrows & Payoff

Usage:
    python cd_benefit_summary.py <path_to_cd.pdf>

Requirements:
    pip install anthropic
    export ANTHROPIC_API_KEY="your-key-here"
"""

import sys
import json
import base64
import textwrap
from pathlib import Path

try:
    import anthropic
except ImportError:
    print("ERROR: anthropic package not found. Run: pip install anthropic")
    sys.exit(1)


# ─── EXTRACTION ──────────────────────────────────────────────────────────────

EXTRACTION_PROMPT = """You are a financial document parser. Extract the following exact values from this Closing Disclosure PDF and return ONLY a valid JSON object with no explanation or markdown.

Required fields:
- sectionA: number (Section A - Origination Charges, borrower-paid at closing total)
- sectionB: number (Section B - Services Borrower Did Not Shop For, borrower-paid total)
- sectionC: number (Section C - Services Borrower Did Shop For, borrower-paid total)
- sectionE: number (Section E - Taxes and Other Government Fees, total)
- lenderCredit: number (Lender Credits from Section J - enter as NEGATIVE number e.g. -13482.00)
- loanAmount: number (Loan Amount from Page 1)
- payoffLines: array of {to: string, amount: number} — ONLY "Payoff to..." lines from Payoffs and Payments page. Do NOT include Principal Reduction here.
- principalReduction: number (Principal Reduction to Consumer — separate line on Payoffs page)
- homeownersInsurancePremium: number (Section F item 01, 0 if blank)
- prepaidInterest: number (Section F item 03, 0 if blank)
- prepaidPropertyTaxes: number (Section F item 04, 0 if blank)
- escrowHomeownersInsurance: number (Section G item 01, 0 if blank)
- escrowMortgageInsurance: number (Section G item 02, 0 if blank)
- escrowPropertyTaxes: number (Section G item 03, 0 if blank)
- escrowCityPropertyTax: number (Section G item 04, 0 if blank)
- aggregateAdjustment: number (Section G Aggregate Adjustment — NEGATIVE if shown negative)
- cashToClose: number (Cash to Close from Page 1)
- loanId: string (Loan ID if visible, else "")

Return ONLY the JSON object, no other text."""


def extract_values(pdf_path: str) -> dict:
    """Use Claude to extract CD values from the PDF."""
    client = anthropic.Anthropic()

    with open(pdf_path, "rb") as f:
        pdf_data = base64.standard_b64encode(f.read()).decode("utf-8")

    print(f"  → Sending to Claude for extraction...")
    msg = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": pdf_data
                    }
                },
                {"type": "text", "text": EXTRACTION_PROMPT}
            ]
        }]
    )

    raw = "".join(b.text for b in msg.content if hasattr(b, "text"))
    raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(raw)


# ─── COMPUTATION ─────────────────────────────────────────────────────────────

def compute(d: dict) -> dict:
    # Part 1
    sec_a = d.get("sectionA", 0) or 0
    sec_b = d.get("sectionB", 0) or 0
    sec_c = d.get("sectionC", 0) or 0
    sec_e = d.get("sectionE", 0) or 0
    lender_credit = d.get("lenderCredit", 0) or 0  # already negative

    sec_d = sec_a + sec_b + sec_c
    total_cost_of_loan = sec_d + sec_e
    benefits_cost = total_cost_of_loan + lender_credit

    # Part 2
    loan_amount = d.get("loanAmount", 0) or 0
    payoff_lines = d.get("payoffLines", []) or []
    payoff_amount = sum(p.get("amount", 0) for p in payoff_lines)
    principal_reduction = d.get("principalReduction", 0) or 0
    excess_payoff = payoff_amount + principal_reduction - loan_amount

    ho_insurance = d.get("homeownersInsurancePremium", 0) or 0
    prepaid_interest = d.get("prepaidInterest", 0) or 0
    prepaid_taxes = d.get("prepaidPropertyTaxes", 0) or 0
    prepaid = ho_insurance + prepaid_interest + prepaid_taxes

    esc_ho = d.get("escrowHomeownersInsurance", 0) or 0
    esc_mi = d.get("escrowMortgageInsurance", 0) or 0
    esc_pt = d.get("escrowPropertyTaxes", 0) or 0
    esc_city = d.get("escrowCityPropertyTax", 0) or 0
    agg_adj = d.get("aggregateAdjustment", 0) or 0  # already negative
    escrows = esc_ho + esc_mi + esc_pt + esc_city + agg_adj

    escrows_prepaid = escrows + prepaid
    escrows_prepaid_excess = escrows_prepaid + excess_payoff
    cash_to_close = d.get("cashToClose", 0) or 0
    benefits_escrow = escrows_prepaid_excess - cash_to_close

    return {
        "sec_a": sec_a, "sec_b": sec_b, "sec_c": sec_c,
        "sec_d": sec_d, "sec_e": sec_e,
        "total_cost_of_loan": total_cost_of_loan,
        "lender_credit": lender_credit,
        "benefits_cost": benefits_cost,
        "loan_amount": loan_amount,
        "payoff_lines": payoff_lines,
        "payoff_amount": payoff_amount,
        "principal_reduction": principal_reduction,
        "excess_payoff": excess_payoff,
        "ho_insurance": ho_insurance,
        "prepaid_interest": prepaid_interest,
        "prepaid_taxes": prepaid_taxes,
        "prepaid": prepaid,
        "esc_ho": esc_ho, "esc_mi": esc_mi, "esc_pt": esc_pt,
        "esc_city": esc_city, "agg_adj": agg_adj,
        "escrows": escrows,
        "escrows_prepaid": escrows_prepaid,
        "escrows_prepaid_excess": escrows_prepaid_excess,
        "cash_to_close": cash_to_close,
        "benefits_escrow": benefits_escrow,
    }


# ─── FORMATTING ──────────────────────────────────────────────────────────────

def fmt(n) -> str:
    """Format number as dollar amount."""
    if n is None:
        return "$0.00"
    abs_n = abs(n)
    s = f"{abs_n:,.2f}"
    return f"-${s}" if n < 0 else f"${s}"


def row(label: str, value, indent=0, width=58) -> str:
    """Print a labeled row with right-aligned value."""
    pad = " " * indent
    label_str = pad + label
    val_str = fmt(value)
    dots = width - len(label_str) - len(val_str)
    if dots < 1:
        dots = 1
    return label_str + ("·" * dots) + val_str


SEP = "─" * 72
DOUBLE = "═" * 72


def print_report(d: dict, c: dict, filename: str):
    loan_id = d.get("loanId", "")
    print()
    print(DOUBLE)
    print("  CLOSING DISCLOSURE — BENEFIT SUMMARY")
    print(f"  File : {filename}")
    if loan_id:
        print(f"  Loan : #{loan_id}")
    print(DOUBLE)

    # ── PART 1 ──────────────────────────────────────────────────────────────
    print()
    print("  PART 1 — SAVINGS DEPICTED BY COST (HOW BENEFITS RECEIVED)")
    print(f"  {'Source: Section H (Loan Costs) + Section J (Lender Credits)'}")
    print(SEP)
    print(row("  Section A — Origination Charges", c["sec_a"]))
    print(row("  Section B — Services You Cannot Shop For", c["sec_b"]))
    print(row("  Section C — Services You Can Shop For", c["sec_c"]))
    print(SEP)
    print(row("  Section D (Sum)  =  A + B + C", c["sec_d"]))
    print(row("  Section E — Taxes and Other Government Fees", c["sec_e"]))
    print(SEP)
    print(row("  Total Cost of Loan  =  D + E", c["total_cost_of_loan"]))
    print(row("  Lender Credit (Section J)  [negative]", c["lender_credit"]))
    print(SEP)
    print(row("  BENEFITS (COST)  =  Total Cost + Lender Credit", c["benefits_cost"]))
    print(DOUBLE)
    if c["benefits_cost"] <= 0:
        print(f"  ✓ Negative result → borrower is SAVING money via lender credits")
    else:
        print(f"  ⚠ Positive result → net cost to borrower after lender credits")

    # ── PART 2 ──────────────────────────────────────────────────────────────
    print()
    print()
    print("  PART 2 — SAVINGS DEPICTED BY ESCROWS & PAYOFF")
    print(f"  {'Source: Pages 1, 3 + Sections F, G'}")
    print(SEP)
    print(row("  Loan Amount (Page 1)", c["loan_amount"]))
    print()
    print("  Payoff Lines (Page 3 — all 'Payoff to...' entries):")
    for p in c["payoff_lines"]:
        print(row(f"    Payoff to {p.get('to','?')}", p.get("amount", 0), width=58))
    print(row("  Payoff Amount  (total of all payoff lines)", c["payoff_amount"]))
    print(row("  Principal Reduction to Consumer", c["principal_reduction"]))
    print(SEP)
    print(row("  Excess Amount over Payoff  =  Payoff + PrinReduct − Loan", c["excess_payoff"]))
    print()
    print("  Section F — Prepaids:")
    print(row("    01  Homeowner's Insurance Premium", c["ho_insurance"], width=58))
    print(row("    03  Prepaid Interest", c["prepaid_interest"], width=58))
    print(row("    04  Property Taxes (prepaid)", c["prepaid_taxes"], width=58))
    print(row("  Prepaid (Section F)", c["prepaid"]))
    print()
    print("  Section G — Initial Escrow Payment at Closing:")
    print(row("    01  Homeowner's Insurance", c["esc_ho"], width=58))
    print(row("    02  Mortgage Insurance", c["esc_mi"], width=58))
    print(row("    03  Property Taxes", c["esc_pt"], width=58))
    print(row("    04  City Property Tax", c["esc_city"], width=58))
    print(row("    08  Aggregate Adjustment  [often negative]", c["agg_adj"], width=58))
    print(row("  Escrows (Section G)", c["escrows"]))
    print(SEP)
    print(row("  Escrows + Prepaid  =  G + F", c["escrows_prepaid"]))
    print(row("  Escrows + Prepaid + Excess Payoff", c["escrows_prepaid_excess"]))
    print(row("  Cash to Close (Page 1)", c["cash_to_close"]))
    print(SEP)
    print(row("  BENEFITS (ESCROW)  =  (Escrows+Prepaid+Excess) − CTC", c["benefits_escrow"]))
    print(DOUBLE)
    if c["benefits_escrow"] >= 0:
        print(f"  ✓ Positive result → borrower receives value beyond cash to close")
    else:
        print(f"  ⚠ Cash to close exceeds escrow & payoff benefits")

    print()

    # ── ASSUMPTIONS ─────────────────────────────────────────────────────────
    print("  ASSUMPTIONS & NOTES")
    print(SEP)
    notes = [
        "Section A uses borrower-paid at-closing total only; lender-paid origination excluded.",
        "Lender Credit is treated as negative; negative Benefits(Cost) = borrower saving money.",
        "Payoff Amount sums ALL 'Payoff to...' lines. Principal Reduction is separate.",
        "Blank Section F / G line items default to $0.00.",
        "Aggregate Adjustment entered as negative per CD convention.",
        "All values are borrower-paid unless otherwise noted.",
    ]
    for note in notes:
        for line in textwrap.wrap(f"  • {note}", width=70):
            print(line)
    print()


# ─── MAIN ────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    pdf_path = sys.argv[1]
    if not Path(pdf_path).exists():
        print(f"ERROR: File not found: {pdf_path}")
        sys.exit(1)

    print(f"\nProcessing: {pdf_path}")
    try:
        print("  → Extracting values from PDF...")
        d = extract_values(pdf_path)
    except Exception as e:
        print(f"ERROR during extraction: {e}")
        sys.exit(1)

    c = compute(d)
    print_report(d, c, Path(pdf_path).name)


if __name__ == "__main__":
    main()
