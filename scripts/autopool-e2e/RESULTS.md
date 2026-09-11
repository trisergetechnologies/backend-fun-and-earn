# Autopool API E2E RESULTS

- **Started:** 2026-09-06T08:01:31.669Z
- **Finished:** 2026-09-06T08:02:35.500Z
- **BASE_URL:** http://localhost:5000/api/v1
- **Git:** aee2501
- **Verdict:** **PASS**

| ID | Title | Intent | Result | ms | Notes |
|---|---|---|---|---:|---|
| S0 | Health, seed, enable, bootstrap root | Setup Autopool so referrers can be active (docs §3 referrer-active) | PASS | 709 | root SN 2030 |
| P_gates | Pain paths — Pool-1 entry gates | Docs §3 package/SN/self/active-referrer; edge cases 1b,18,20,21 | PASS | 2921 | P1 disabled; P2 no package; P3 insufficient; P4 self; P5 invalid SN; P6 inactive referrer; P7 occupying |
| H1_H2 | Happy Join P1 + idempotent retry | Docs §3.1 manual entry; tech idempotency; referrer +1 credit | PASS | 1072 | subject SN 2039; debit ok; idempotent ok |
| C1_C5 | FIFO cycles 1 and 5 — eligibility created | Docs §5–6 cycle distribution; exactly one eligibility at cycle 5 | PASS | 3647 | cycles 1+5 ok; eligibility id 6a9d1de6a496dc9f6711187a |
| C6_C15 | Cycle 6 Feature redirect + Cycle 15 termination | Docs §6 cycles 6–15; §11 cycle 15; no cycle 16 | PASS | 8608 | C6 feature redirect; C15 complete; no C16 |
| J_gates | Join-next gates + happy join pool 2 | Docs §15 credits; §7 join next; §10 hold when occupying | PASS | 7283 | J1 no credit; J2 no elig; J3 join P2 ok |
| J4_hold | Eligibility held when target pool occupying | Docs §10 — do not Feature-forfeit; hold AVAILABLE; join blocked | PASS | 3920 | eligibility held; join blocked TARGET_OCCUPYING |
| R_release | Release gate — re-entry blocked until upgrade used + 15/15 | Docs §8.1 release; edge case 2 vs not-released | PASS | 16165 | R2 block ok; R1 re-entry after release ok |
| R3_R4_pool10 | Pool 10 credit reset with/without other occupying pools | Docs §15.3 credit reset on Pool10 15/15 | PASS | 16304 | R3 reset; R4 no reset |
| L1_legacy | Legacy referredBy unchanged after Autopool join | Docs §16 / edge 28 — Autopool referral is separate | PASS | 466 | referredBy stayed LEGACYE2E1 |

See [SCENARIO_CATALOG.md](./SCENARIO_CATALOG.md) for why each scenario exists.
