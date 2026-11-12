import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ClassificationProposalV1 } from "./factualClassification";
import { claimKeyV1, DeterministicEvidenceCorroboratorV1, type CorroborationInputV1, type CorroborationResultV1 } from "./evidenceCorroboration";

export type FactualDependencyV1 = Readonly<{ dependencyType: "N2_PUBLICATION_REVISION" | "N3A_PROPOSAL" | "N3B_EVALUATION" | "FACT_REVISION"; dependencyRef: string; asKnownAt: string }>;
export type FactualEvidenceRefV1 = Readonly<{ evidenceId: string; evidenceKind: "N3A_PROPOSAL" | "N3B_EVIDENCE" | "N3B_PROOF"; claimKey: string; publicationRevisionId: string; sourceDocumentRef: string; contentLocator: string; provenanceRef: string; asKnownAt: string }>;
export type FactualRelationV1 = Readonly<{ relatedRevisionId: string; relationType: "CORRECTS" | "CONTESTS" | "RETRACTS" }>;
export type PersistFactualInputV1 = Readonly<{ canonicalClaimId: string; proposal: ClassificationProposalV1; corroboration: CorroborationResultV1; corroborationInput: CorroborationInputV1; evidence: readonly FactualEvidenceRefV1[]; dependencies: readonly FactualDependencyV1[]; relation?: FactualRelationV1; }>;
export type PersistFactualResultV1 = Readonly<{ inserted: boolean; factEventId: string; factRevisionId: string | null; revisionNo: number | null; logicalFingerprint: string }>;
export type FactAsOfRowV1 = Readonly<{ factEventId: string; factRevisionId: string; revisionNo: number; canonicalClaimId: string; category: string; claimType: string; statement: string; occurredAt: string | null; scheduledFor: string | null; confirmationStatus: string; lifecycleStatus: string; polarity: string; asKnownAt: string; committedAt: string }>;
export type FactEvidenceAsOfRowV1 = Readonly<{ factRevisionId: string; evidenceId: string; evidenceKind: string; claimKey: string; publicationRevisionId: string; sourceDocumentRef: string; contentLocator: string; provenanceRef: string; asKnownAt: string }>;

const stable = (value: unknown): string => { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; return `{${Object.keys(value as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`; };
const fingerprint = (input: PersistFactualInputV1): string => createHash("sha256").update(stable({ canonicalClaimId: input.canonicalClaimId, proposal: { ...input.proposal, proposedAt: undefined }, corroboration: { ...input.corroboration, evaluatedAt: undefined }, evidence: [...input.evidence].sort((a,b) => a.evidenceId.localeCompare(b.evidenceId)), dependencies: [...input.dependencies].sort((a,b) => `${a.dependencyType}:${a.dependencyRef}`.localeCompare(`${b.dependencyType}:${b.dependencyRef}`)), relation: input.relation ?? null })).digest("hex");
const instant = (value: string): number => { const result = Date.parse(value); if (!Number.isFinite(result)) throw new Error("NEWS_FACT_TIMESTAMP_INVALID"); return result; };

export class PostgresFactualStore {
  constructor(private readonly pool: Pool, private readonly databaseRole: "news_factual_writer" | "news_service" = "news_factual_writer") {}
  async close(): Promise<void> { await this.pool.end(); }
  private async publishRevision(revisionId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${this.databaseRole}`);
      await client.query("select * from news_core.publish_fact_revision_v1($1)", [revisionId]);
      await client.query("commit");
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async persist(input: PersistFactualInputV1, failurePoint: "none" | "before-commit" | "after-commit" = "none", holdBeforeCommitMs = 0): Promise<PersistFactualResultV1> {
    const logicalFingerprint = fingerprint(input);
    if (!input.canonicalClaimId || input.proposal.publicationRevisionId === "" || input.evidence.length === 0) throw new Error("NEWS_FACT_INPUT_INVALID");
    if (input.proposal.occurredAt && input.proposal.scheduledFor) throw new Error("NEWS_FACT_TEMPORAL_FIELDS_CONFLICT");
    if (input.corroboration.canonicalClaimId !== input.canonicalClaimId || input.corroboration.claimKey !== claimKeyV1(input.proposal)) throw new Error("NEWS_FACT_CORROBORATION_IDENTITY_INVALID");
    for (const evidence of input.evidence) {
      const proposalEvidence = input.proposal.evidenceRefs.find(ref => ref.evidenceId === evidence.evidenceId);
      if (evidence.evidenceKind === "N3A_PROPOSAL" && (!input.proposal.evidenceIds.includes(evidence.evidenceId) || !proposalEvidence || proposalEvidence.sourceDocumentRef !== evidence.sourceDocumentRef || proposalEvidence.contentLocator !== evidence.contentLocator)) throw new Error("NEWS_FACT_N3A_EVIDENCE_MISMATCH");
    }
    const n2Dependencies = input.dependencies.filter(item => item.dependencyType === "N2_PUBLICATION_REVISION");
    const n3aDependencies = input.dependencies.filter(item => item.dependencyType === "N3A_PROPOSAL");
    const n3bDependencies = input.dependencies.filter(item => item.dependencyType === "N3B_EVALUATION");
    if (n2Dependencies.length !== 1 || n2Dependencies[0].dependencyRef !== input.proposal.publicationRevisionId || n3aDependencies.length !== 1 || n3aDependencies[0].dependencyRef !== input.proposal.inputFingerprint || n3bDependencies.length !== 1 || n3bDependencies[0].dependencyRef !== input.corroboration.fingerprint) throw new Error("NEWS_FACT_DEPENDENCY_RECEIPT_INVALID");
    if (input.corroborationInput.proposal.publicationRevisionId !== input.proposal.publicationRevisionId || input.corroborationInput.claimKey !== input.corroboration.claimKey || input.corroborationInput.proposal.inputFingerprint !== input.proposal.inputFingerprint || input.corroborationInput.proposal.lifecycleStatus !== input.proposal.lifecycleStatus || input.corroborationInput.proposal.polarity !== input.proposal.polarity) throw new Error("NEWS_FACT_CORROBORATION_INPUT_MISMATCH");
    const evaluated = new DeterministicEvidenceCorroboratorV1().evaluate(input.corroborationInput);
    if (evaluated.claimKey !== input.corroboration.claimKey || evaluated.canonicalClaimId !== input.corroboration.canonicalClaimId || evaluated.fingerprint !== input.corroboration.fingerprint || stable({ ...evaluated, evaluatedAt: undefined }) !== stable({ ...input.corroboration, evaluatedAt: undefined })) throw new Error("NEWS_FACT_CORROBORATION_RESULT_MISMATCH");
    if (input.corroboration.lifecycleStatus !== input.proposal.lifecycleStatus || input.corroboration.polarity !== input.proposal.polarity) throw new Error("NEWS_FACT_STATE_MISMATCH");
    if (input.proposal.lifecycleStatus === "CORRECTED" && (!input.relation || input.relation.relationType !== "CORRECTS")) throw new Error("NEWS_FACT_CORRECTION_RELATION_REQUIRED");
    if (input.proposal.lifecycleStatus === "RETRACTED" && (!input.relation || input.relation.relationType !== "RETRACTS")) throw new Error("NEWS_FACT_RETRACTION_RELATION_REQUIRED");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      if (this.databaseRole) await client.query(`set local role ${this.databaseRole}`);
      const serverNow = (await client.query<{ now: Date }>("select clock_timestamp() now")).rows[0].now.valueOf();
      if (instant(input.proposal.proposedAt) > serverNow || instant(input.corroboration.evaluatedAt) > serverNow) throw new Error("NEWS_FACT_FUTURE_PROPOSAL");
      for (const dependency of input.dependencies) if (!dependency.dependencyRef || instant(dependency.asKnownAt) > serverNow) throw new Error("NEWS_FACT_FUTURE_DEPENDENCY");
      for (const evidence of input.evidence) if (instant(evidence.asKnownAt) > serverNow) throw new Error("NEWS_FACT_FUTURE_EVIDENCE");
      if (failurePoint === "before-commit") throw new Error("INJECTED_FAILURE_BEFORE_COMMIT");
      const payload = {
        canonicalClaimId: input.canonicalClaimId,
        taxonomyVersion: input.proposal.taxonomyVersion,
        category: input.proposal.category,
        logicalFingerprint,
        ruleSetVersion: input.proposal.ruleSetVersion,
        claimType: input.proposal.claimType,
        statement: input.proposal.statement,
        subjectRef: input.proposal.subjectRef,
        objectRef: input.proposal.objectRef,
        occurredAt: input.proposal.occurredAt,
        scheduledFor: input.proposal.scheduledFor,
        confirmationStatus: input.corroboration.confirmationStatus,
        lifecycleStatus: input.corroboration.lifecycleStatus,
        polarity: input.corroboration.polarity,
        focalClaimKey: input.corroboration.claimKey,
        publicationRevisionId: input.proposal.publicationRevisionId,
        qualityFlags: input.proposal.qualityFlags,
        evidence: input.evidence,
        dependencies: input.dependencies,
        relation: input.relation ?? null,
        seal: failurePoint !== "after-commit" && holdBeforeCommitMs === 0,
      };
      const result = await client.query<{ inserted: boolean; fact_event_id: string; fact_revision_id: string; revision_no: number; logical_fingerprint: string }>("select * from news_core.persist_fact_revision_v1($1::jsonb)", [JSON.stringify(payload)]);
      const row = result.rows[0];
      if (!row) throw new Error("NEWS_FACT_WRITE_RESULT_UNAVAILABLE");
      if (holdBeforeCommitMs > 0) await new Promise(resolve => setTimeout(resolve, holdBeforeCommitMs));
      await client.query("commit");
      if (failurePoint === "after-commit") throw new Error("INJECTED_FAILURE_AFTER_COMMIT");
      if (!payload.seal && row.fact_revision_id) await this.publishRevision(row.fact_revision_id);
      return { inserted: row.inserted, factEventId: row.fact_event_id, factRevisionId: row.fact_revision_id, revisionNo: row.revision_no, logicalFingerprint: row.logical_fingerprint };
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async readAsOf(asOf: string): Promise<FactAsOfRowV1[]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      if (this.databaseRole) await client.query(`set local role ${this.databaseRole}`);
      const result = await client.query<FactAsOfRowV1>("select \"factEventId\",\"factRevisionId\",\"revisionNo\",\"canonicalClaimId\",category,\"claimType\",statement,\"occurredAt\",\"scheduledFor\",\"confirmationStatus\",\"lifecycleStatus\",polarity,\"asKnownAt\",\"committedAt\" from news_core.read_fact_revisions_as_of($1)", [asOf]);
      await client.query("commit");
      return result.rows;
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async readFilteredAsOf(asOf: string, targets: readonly string[], eventTypes: readonly string[], from: string | null, to: string | null): Promise<FactAsOfRowV1[]> {
    const client = await this.pool.connect();
    try { await client.query("begin"); if (this.databaseRole) await client.query(`set local role ${this.databaseRole}`); const result = await client.query<FactAsOfRowV1>("select * from news_core.read_fact_revisions_filtered_as_of($1,$2::text[],$3::text[],$4::timestamptz,$5::timestamptz)", [asOf, targets, eventTypes, from, to]); await client.query("commit"); return result.rows; }
    catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async readHistoryFilteredAsOf(asOf: string, targets: readonly string[], from: string | null, to: string | null): Promise<FactAsOfRowV1[]> {
    const client = await this.pool.connect();
    try { await client.query("begin"); if (this.databaseRole) await client.query(`set local role ${this.databaseRole}`); const result = await client.query<FactAsOfRowV1>("select * from news_core.read_fact_history_filtered_as_of($1,$2::text[],$3::timestamptz,$4::timestamptz)", [asOf, targets, from, to]); await client.query("commit"); return result.rows; }
    catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async readHistoryAsOf(asOf: string, factEventId: string): Promise<FactAsOfRowV1[]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      if (this.databaseRole) await client.query(`set local role ${this.databaseRole}`);
      const result = await client.query<FactAsOfRowV1>("select * from news_core.read_fact_history_as_of($1,$2)", [asOf, factEventId]);
      await client.query("commit");
      return result.rows;
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async readEvidenceAsOf(asOf: string, factRevisionId: string): Promise<FactEvidenceAsOfRowV1[]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      if (this.databaseRole) await client.query(`set local role ${this.databaseRole}`);
      const result = await client.query<FactEvidenceAsOfRowV1>("select * from news_core.read_fact_evidence_as_of($1,$2)", [asOf, factRevisionId]);
      await client.query("commit");
      return result.rows;
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
  }
}
