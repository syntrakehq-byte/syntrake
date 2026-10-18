import assert from "node:assert/strict";
import test from "node:test";
import { assertBalanced, netByLedgerAccount } from "../domain/ledger";
import { addMoney, currencyMinorDigits, money, subtractMoney } from "../domain/money";
import { parseUserReportedContributionJson } from "../server/contributionJsonContract";
import { createRehearsalWriterPool, parseRehearsalWriterPoolConfig, InvestingWriterConfigurationBlocked } from "../server/privateWriterPool";

const account = "00000000-0000-4000-8000-000000000011";
const cash = "00000000-0000-4000-8000-000000000021";
const clearing = "00000000-0000-4000-8000-000000000022";

test("exact minor-unit arithmetic and supported ISO 4217 currency exponents", () => {
  assert.equal(addMoney(money("EUR", 1n), money("EUR", 2n)).minor, 3n);
  assert.equal(currencyMinorDigits.JPY, 0);
  assert.equal(currencyMinorDigits.KWD, 3);
  assert.throws(() => money("ZZZ", 1n));
  assert.throws(() => money("EUR", -1n));
  assert.throws(() => addMoney(money("EUR", 1n), money("USD", 1n)), /currency mismatch/);
  assert.throws(() => subtractMoney(money("EUR", 1n), money("EUR", 2n)), /insufficient balance/);
});

test("double-entry requires distinct internal accounts, one investing account and exact per-currency balance", () => {
  const entries = [
    { investmentAccountId: account, ledgerAccountId: cash, direction: "debit" as const, currency: "EUR" as const, minor: 100n },
    { investmentAccountId: account, ledgerAccountId: clearing, direction: "credit" as const, currency: "EUR" as const, minor: 100n },
  ];
  assert.doesNotThrow(() => assertBalanced(entries));
  assert.throws(() => assertBalanced([{ ...entries[0], minor: 99n }, entries[1]]), /unbalanced/);
  assert.throws(() => assertBalanced([{ ...entries[0], ledgerAccountId: cash }, { ...entries[1], ledgerAccountId: cash }]), /distinct/);
  assert.throws(() => assertBalanced([{ ...entries[0], investmentAccountId: account }, { ...entries[1], investmentAccountId: "00000000-0000-4000-8000-000000000099" }]), /cross-investment-account/);
  assert.equal(netByLedgerAccount(entries).get(cash)?.minor, -100n);
  assert.equal(netByLedgerAccount(entries).get(clearing)?.minor, 100n);
});

test("future HTTP JSON contribution contract preserves minor units and rejects client authority", () => {
  const body={
    accountId:account,
    idempotencyKey:"canonical-json-00000001",
    currency:"EUR",
    amountMinor:"9007199254740993",
    externalReference:"bank-note-00001",
  };
  const decoded=parseUserReportedContributionJson(body);
  assert.equal(decoded.amountMinor,9007199254740993n);
  assert.equal(typeof decoded.amountMinor,"bigint");
  assert.equal(decoded.accountId,account);
  // JavaScript number parsing would lose precision: it must NOT be accepted.
  assert.throws(()=>parseUserReportedContributionJson({...body,amountMinor:9007199254740993}));
  assert.throws(()=>parseUserReportedContributionJson({...body,amountMinor:1.5}));
  assert.throws(()=>parseUserReportedContributionJson({...body,amountMinor:"0"}));
  assert.throws(()=>parseUserReportedContributionJson({...body,amountMinor:"01"}));
  assert.throws(()=>parseUserReportedContributionJson({...body,amountMinor:"1e3"}));
  assert.throws(()=>parseUserReportedContributionJson({...body,amountMinor:"-1"}));
  assert.throws(()=>parseUserReportedContributionJson({...body,amountMinor:"1".repeat(39)}));
  assert.equal(
    parseUserReportedContributionJson({...body,amountMinor:"9".repeat(38)}).amountMinor,
    BigInt("9".repeat(38)),
  );
  for(const forged of [
    {userId:"clerk_user_a"},
    {sessionId:"unverified_session"},
    {actor:{userId:"clerk_user_a",sessionId:"fabricated"}},
    {role:"investing_contribution_writer"},
    {accessToken:"fabricated_token"},
  ]) {
    assert.throws(()=>parseUserReportedContributionJson({...body,...forged}));
  }
});

test("private pg writer config fail-closed: non-rehearsal, no secrets, TLS downgrade, wrong host or SQL role", async () => {
  const ref="zkqgpejlkgootkvkebhd";
  const valid={
    INVESTING_WRITER_MODE:"rehearsal",
    INVESTING_WRITER_PROJECT_REF:ref,
    INVESTING_WRITER_DATABASE_URL:`postgresql://investing_writer_runtime:p%40ssword@db.${ref}.supabase.co:5432/postgres`,
  };
  const result=parseRehearsalWriterPoolConfig(valid);
  assert.deepEqual(result.ssl,{rejectUnauthorized:true});
  assert.equal(result.max,2);
  assert.equal(result.connectionTimeoutMillis,2500);
  assert.equal(result.idleTimeoutMillis,10000);

  for(const env of [
    {...valid,INVESTING_WRITER_MODE:"production"},
    {...valid,INVESTING_WRITER_MODE:undefined},
    {...valid,INVESTING_WRITER_DATABASE_URL:undefined},
    {...valid,INVESTING_WRITER_PROJECT_REF:undefined},
    {...valid,INVESTING_WRITER_PROJECT_REF:"vbazzxqyuqcrmjytaboc",},
    {...valid,INVESTING_WRITER_DATABASE_URL:"postgresql://postgres:password@db."+ref+".supabase.co:5432/postgres"},
    {...valid,INVESTING_WRITER_DATABASE_URL:"postgresql://investing_contribution_writer:password@db."+ref+".supabase.co:5432/postgres"},
    {...valid,INVESTING_WRITER_DATABASE_URL:"postgresql://investing_writer_runtime:password@db."+ref+".supabase.co:5432/postgres?sslmode=disable"},
    {...valid,INVESTING_WRITER_DATABASE_URL:"postgresql://investing_writer_runtime:password@db."+ref+".supabase.co:5432/postgres?options=-c%20search_path%3Dpublic"},
    {...valid,INVESTING_WRITER_DATABASE_URL:"postgresql://investing_writer_runtime:password@127.0.0.1:5432/postgres"},
    {...valid,INVESTING_WRITER_DATABASE_URL:"postgresql://investing_writer_runtime:password@db."+ref+".supabase.co:5433/postgres"},
    {...valid,INVESTING_WRITER_DATABASE_URL:"postgresql://investing_writer_runtime:password@db."+ref+".supabase.co:5432/notpostgres"},
    {...valid,INVESTING_WRITER_DATABASE_URL:"not a connection"},
  ]) {
    assert.throws(()=>parseRehearsalWriterPoolConfig(env),(e:unknown)=>{
      assert.equal((e as Error).message,"INVESTING_WRITER_CONFIGURATION_BLOCKED");
      assert.ok(e instanceof InvestingWriterConfigurationBlocked);
      return true;
    });
  }

  // No client connects and no secret is logged just by constructing the Pool.
  const pool=createRehearsalWriterPool(valid);
  try {
    assert.equal(pool.totalCount,0);
    assert.equal(pool.idleCount,0);
    assert.equal(pool.waitingCount,0);
  } finally {
    await pool.end();
  }
});
