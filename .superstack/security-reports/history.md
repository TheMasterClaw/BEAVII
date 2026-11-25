## 2026-11-25 — BEAVII
- Mode: Comprehensive
- Findings: 16 (C: 0, H: 3, M: 6, L: 3, I: 4)
- New: 16 | Resolved: 0 | Persistent: 0 (first audit)
- Confidence gate: 2/10

### 2026-11-25 remediation (same day)
- F-01 fixed: /api/flow/rebalance requires the bearer secret and no longer proxies it; shared logic in src/lib/stock-agent.ts; constant-time secret compare.
- F-02 code side fixed: production refuses DEPLOYER_PRIVATE_KEY as signer; scripts/setup-agent-key.mjs grants a separate agent key narrow roles. Pending: run the script, rotate Vercel env.
- F-09 partly fixed: removed 9 unused deps + Moralis; ethers 6.17.0. npm audit 67 -> 25 (critical 3 -> 0). Remaining highs come from @reown/appkit (no upstream fix).
- Agent key live: 0x31776787A64b529E3A1764ffa4BdFffb6F63CD6d (exchange agent, flagship agent, factory defaultAgent, MINT_ROLE on 416 tokens). Verified via staticCall + a real 415-price sync in production mode.
- F-03 server side fixed: sync-prices requires the bearer secret; public Sync buttons removed. Contract-side fix (delayed pricing) still open.
- F-04 mitigated: per-IP + per-address cooldown, hourly cap, agent gas floor, signer lock (per instance; KV needed for global limits).
- F-07 fixed: normalized symbols (max 50), fixed listing limits. F-08 partly: anti-framing + HSTS/nosniff/referrer/permissions headers; full script CSP pending.
- F-10 fixed: etfId validated + encoded. F-11 fixed in agent, faucet, market routes.
- Open: F-05, F-06 (need contract redeploy), F-12 (mock verification), Vercel env rotation.
- F-05 fixed for new ETFs, downgraded to LOW: all 415 stocks use 8 decimals, so the inflation attack was mostly theoretical. New vault impl 0x5D04f93b1F2175ce6adba4aC6a93782b0E407D85 adds DEAD_SHARES + depositWithMin. New factory 0xF30480a76721a4972cead4cFa69e0ff083358ab8 (exchange.setFactory). Old flagship 0x1f5D…62aB kept (still listed, still works). On-chain test: 5/5 safety checks passed (victim lost $0.0000013 of $150 after a $100 donation).
- F-06 mitigated off-chain: the agent holds back moves >25% vs the onchain price (syncPrices({force:true}) overrides). On-chain bound needs an exchange redeploy (mainnet).
- F-12 fixed: mock verification routes return 404 in production unless ENABLE_MOCK_VERIFICATION=true; duplicate src/app/verify-twitter routes removed.
- Vercel (ericnans-gmailcoms-projects/beavii): prod env has STOCK_AGENT_PRIVATE_KEY, STOCK_AGENT_SECRET, CRON_SECRET, CMC_API_KEY; DEPLOYER_PRIVATE_KEY absent. Deployment dpl_BL8AiTZv5BHvZvRfN5z1C7531A6j (Ready) matches the local security fixes file-for-file. Deployment Protection (SSO) is on.
- Not yet verified: that prod STOCK_AGENT_PRIVATE_KEY is 0x3177…CD6d (sensitive vars can't be read back); confirm from the first cron sync tx sender.
- New surface to audit: AGENT_WALLET_SEED (src/lib/agent-accounts derives every agent wallet from it), the Supabase/Postgres secrets, and /api/agents/v1.
- Vercel prod env overwritten (user-approved) with the local STOCK_AGENT_PRIVATE_KEY (0x3177…CD6d), STOCK_AGENT_SECRET, CRON_SECRET; AGENT_WALLET_SEED and CMC_API_KEY untouched. Production redeployed (beavii-5v8cglmri). Prod signer = verified agent key by construction; first cron sync will confirm on-chain.
