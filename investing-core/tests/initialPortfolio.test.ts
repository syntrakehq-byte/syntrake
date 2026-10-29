import assert from "node:assert/strict";
import test from "node:test";
import { initializeCommand, initializeFirstInvestingPortfolio, InitialPortfolioBlocked }
  from "../server/initializeFirstPortfolio";

const valid = {
  idempotencyKey: "00000000-0000-4000-8000-000000000321",
  accountName: " Investing Principal ",
  portfolioName: " Long Term ",
  baseCurrency: "EUR",
};

test("R2-C2 first-account request is structural only; forged financial or tenant fields refused", () => {
  const parsed = initializeCommand.parse(valid);
  assert.equal(parsed.accountName, "Investing Principal");
  assert.equal(parsed.portfolioName, "Long Term");
  assert.equal(parsed.baseCurrency, "EUR");
  for (const mutation of [
    { userId: "user_other" }, { accountId: "00000000-0000-4000-8000-000000000321" },
    { ownerId: "user_other" }, { tenantId: "forged" }, { investmentAccountId: "xyz" },
    { brokerId: "broker-other" }, { cash: 2000 }, { currencyBalance: "0" },
    { depositMinor: "1000" }, { tradingBook: "other" }, { mandate: "LIVE" },
    { autoTrade: true }, { baseCurrency: "BTC" }, { accountName: "" },
    { portfolioName: "z".repeat(81) },
  ]) {
    assert.equal(initializeCommand.safeParse({ ...valid, ...mutation }).success, false);
  }
});

test("R2-C2 fails before DB connection on invalid/missing verified server actor", async () => {
  let calls=0;
  const pool={connect:async()=>{calls++;throw Error("MUST NOT CONNECT")}};
  for(const actor of [
    {userId:null,sessionId:null},
    {userId:"user_abc123",sessionId:null},
    {userId:"not-clerk-actor",sessionId:"clerk"},
  ]){
    await assert.rejects(initializeFirstInvestingPortfolio(pool as never,actor,valid),
      (e:unknown)=>e instanceof InitialPortfolioBlocked&&e.code==="UNAUTHENTICATED");
  }
  await assert.rejects(initializeFirstInvestingPortfolio(pool as never,
    {userId:"user_clerk_actor123",sessionId:"session"}, {...valid,userId:"forged"}),
    (e:unknown)=>e instanceof InitialPortfolioBlocked&&e.code==="INVALID_INPUT");
  assert.equal(calls,0);
});
