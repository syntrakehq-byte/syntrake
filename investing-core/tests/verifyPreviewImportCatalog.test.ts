import assert from "node:assert/strict";
import test from "node:test";
import type {Pool} from "pg";
import {
  assertPreviewImportCatalogReady,PreviewImportCatalogBlocked,
} from "../server/verifyPreviewImportCatalog";

const ready={
  missingCoverageColumns:"0",incompatibleImportTables:"0",
  safeWriterRole:true,privateImportRoleCanWrite:true,
  authenticatedCanInsert:false,writerCanPostLedger:false,
  writerCanFinalize:true,writerCanEditDeclaredCurrency:false,writerCanDeleteSnapshot:false,
  privilegedProvisioningRpcExposed:false,
};
function mockCatalog(row:Record<string,unknown>|null=ready,fail=false){
  const sql:string[]=[];let release=0;
  const pool={
    connect:async()=>({
      query:async(query:string)=>{
        sql.push(query);
        if(fail&&query.includes("SELECT"))throw Error("DO_NOT_LEAK_DB_INTERNAL");
        if(query.includes("SELECT"))return {rows:row?[row]:[]};
        return {rows:[]};
      },
      release:()=>{release++},
    }),
  } as unknown as Pick<Pool,"connect">;
  return {pool,sql,releases:()=>release};
}
test("R2 Preview catalog guard is read only and releases DB session",async()=>{
 const f=mockCatalog();
 await assert.doesNotReject(assertPreviewImportCatalogReady(f.pool));
 assert.equal(f.sql[0],"BEGIN READ ONLY");
 assert.equal(f.sql[1],"SET LOCAL ROLE investing_import_writer");
 assert.ok(f.sql[2].startsWith("SELECT "));
 assert.equal(f.sql.at(-1),"ROLLBACK");
 assert.equal(f.releases(),1);
 assert.equal(f.sql.some(q=>/^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|GRANT|REVOKE)\b/i.test(q)),
   false,"preflight must never alter DB");
});
test("R2 Preview rejects missing columns, absent/unsafe role, public writer, ledger ability and exposed RPC",async()=>{
 const invalidRows=[
  {missingCoverageColumns:"1"},
  {incompatibleImportTables:"2"},
  {safeWriterRole:false},
  {privateImportRoleCanWrite:false},
  {authenticatedCanInsert:true},
  {writerCanPostLedger:true},
  {writerCanFinalize:false},
  {writerCanEditDeclaredCurrency:true},
  {writerCanDeleteSnapshot:true},
  {privilegedProvisioningRpcExposed:true},
 ];
 for(const bad of invalidRows){
   const f=mockCatalog({...ready,...bad});
   await assert.rejects(assertPreviewImportCatalogReady(f.pool),
     (e:unknown)=>e instanceof PreviewImportCatalogBlocked&&
       e.message==="R2_PREVIEW_CATALOG_BLOCKED");
   assert.equal(f.releases(),1);
   assert.equal(f.sql.at(-1),"ROLLBACK");
 }
});
test("R2 Preview fails closed on provider errors, missing catalog row or ambiguous rows",async()=>{
 const down=mockCatalog(ready,true);
 await assert.rejects(assertPreviewImportCatalogReady(down.pool),
   (e:unknown)=>e instanceof PreviewImportCatalogBlocked&&
     !e.message.includes("DO_NOT_LEAK_DB_INTERNAL"));
 assert.equal(down.releases(),1);
 assert.equal(down.sql.at(-1),"ROLLBACK");
 const missing=mockCatalog(null);
 await assert.rejects(assertPreviewImportCatalogReady(missing.pool),
   (e:unknown)=>e instanceof PreviewImportCatalogBlocked);
 assert.equal(missing.releases(),1);
});
