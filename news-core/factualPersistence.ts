import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ClassificationProposalV1 } from "./factualClassification";
import { claimKeyV1, DeterministicEvidenceCorroboratorV1, type CorroborationInputV1, type CorroborationResultV1 } from "./evidenceCorroboration";

export type FactualDependencyV1 = Readonly<{ dependencyType: "N2_PUBLICATION_REVISION" | "N3A_PROPOSAL" | "N3B_EVALUATION" | "FACT_REVISION"; dependencyRef: string; asKnownAt: string }>;
export type FactualEvidenceRefV1 = Readonly<{ evidenceId: string; evidenceKind: "N3A_PROPOSAL" | "N3B_EVIDENCE" | "N3B_PROOF"; claimKey: string; publicationRevisionId: string; sourceDocumentRef: string; contentLocator: string; provenanceRef: string; asKnownAt: string }>;
export type FactualRelationV1 = Readonly<{ relatedRevisionId: string; relationType: "CORRECTS" | "CONTESTS" | "RETRACTS" }>;
export type PersistFactualInputV1 = Readonly<{ canonicalClaimId: string; proposal: ClassificationProposalV1; corroboration: CorroborationResultV1; corroborationInput?: CorroborationInputV1; evidence: readonly FactualEvidenceRefV1[]; dependencies: readonly FactualDependencyV1[]; relation?: FactualRelationV1; }>;
export type PersistFactualResultV1 = Readonly<{ inserted: boolean; factEventId: string; factRevisionId: string | null; revisionNo: number | null; logicalFingerprint: string }>;
export type FactAsOfRowV1 = Readonly<{ factEventId: string; factRevisionId: string; revisionNo: number; canonicalClaimId: string; category: string; claimType: string; statement: string; occurredAt: string | null; scheduledFor: string | null; confirmationStatus: string; lifecycleStatus: string; polarity: string; asKnownAt: string; committedAt: string }>;

const stable = (value: unknown): string => { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; return `{${Object.keys(value as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`; };
const fingerprint = (input: PersistFactualInputV1): string => createHash("sha256").update(stable({ canonicalClaimId: input.canonicalClaimId, proposal: { ...input.proposal, proposedAt: undefined }, corroboration: { ...input.corroboration, evaluatedAt: undefined }, evidence: [...input.evidence].sort((a,b) => a.evidenceId.localeCompare(b.evidenceId)), dependencies: [...input.dependencies].sort((a,b) => `${a.dependencyType}:${a.dependencyRef}`.localeCompare(`${b.dependencyType}:${b.dependencyRef}`)), relation: input.relation ?? null })).digest("hex");
const instant = (value: string): number => { const result = Date.parse(value); if (!Number.isFinite(result)) throw new Error("NEWS_FACT_TIMESTAMP_INVALID"); return result; };

export class PostgresFactualStore {
  constructor(private readonly pool: Pool, private readonly databaseRole: "news_service" | null = null) {}
  async close(): Promise<void> { await this.pool.end(); }

  async persist(input: PersistFactualInputV1, failurePoint: "none" | "before-commit" | "after-commit" = "none"): Promise<PersistFactualResultV1> {
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
    if (["PRIMARY_CONFIRMED", "CORROBORATED"].includes(input.corroboration.confirmationStatus)) {
      if (!input.corroborationInput) throw new Error("NEWS_FACT_CORROBORATION_PROOF_REQUIRED");
      const evaluated = new DeterministicEvidenceCorroboratorV1().evaluate(input.corroborationInput);
      if (evaluated.claimKey !== input.corroboration.claimKey || evaluated.canonicalClaimId !== input.corroboration.canonicalClaimId || evaluated.fingerprint !== input.corroboration.fingerprint || stable({ ...evaluated, evaluatedAt: undefined }) !== stable({ ...input.corroboration, evaluatedAt: undefined })) throw new Error("NEWS_FACT_CORROBORATION_RESULT_MISMATCH");
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      if (this.databaseRole) await client.query(`set local role ${this.databaseRole}`);
      const serverNow = (await client.query<{ now: Date }>("select clock_timestamp() now")).rows[0].now.valueOf();
      if (instant(input.proposal.proposedAt) > serverNow || instant(input.corroboration.evaluatedAt) > serverNow) throw new Error("NEWS_FACT_FUTURE_PROPOSAL");
      for (const dependency of input.dependencies) if (!dependency.dependencyRef || instant(dependency.asKnownAt) > serverNow) throw new Error("NEWS_FACT_FUTURE_DEPENDENCY");
      for (const evidence of input.evidence) if (instant(evidence.asKnownAt) > serverNow) throw new Error("NEWS_FACT_FUTURE_EVIDENCE");
      const publication = await client.query<{ source_document_ref: string; as_known_at: Date }>("select source_document_ref,as_known_at from news_core.publication_revisions where publication_revision_id=$1 and visibility_state='COMMITTED'", [input.proposal.publicationRevisionId]);
      if (publication.rowCount !== 1 || instant(input.proposal.dependencyAsKnownAt) < instant(publication.rows[0].as_known_at.toISOString())) throw new Error("NEWS_FACT_PUBLICATION_REVISION_INVALID");
      for (const evidence of input.evidence) {
        const revision = await client.query<{ source_document_ref: string; as_known_at: Date }>("select source_document_ref,as_known_at from news_core.publication_revisions where publication_revision_id=$1 and visibility_state='COMMITTED'", [evidence.publicationRevisionId]);
        if (revision.rowCount !== 1 || revision.rows[0].source_document_ref !== evidence.sourceDocumentRef || instant(evidence.asKnownAt) < instant(revision.rows[0].as_known_at.toISOString())) throw new Error("NEWS_FACT_EVIDENCE_REFERENCE_INVALID");
      }
      const event = await client.query<{ fact_event_id: string }>("insert into news_core.fact_events(fact_event_id,canonical_claim_id,taxonomy_version,category) values ($1,$1,$2,$3) on conflict(canonical_claim_id) do nothing returning fact_event_id", [input.canonicalClaimId, input.proposal.taxonomyVersion, input.proposal.category]);
      const eventId = event.rows[0]?.fact_event_id ?? (await client.query<{ fact_event_id: string }>("select fact_event_id from news_core.fact_events where canonical_claim_id=$1", [input.canonicalClaimId])).rows[0]?.fact_event_id;
      if (!eventId) throw new Error("NEWS_FACT_EVENT_ID_UNAVAILABLE");
      await client.query("select fact_event_id from news_core.fact_events where fact_event_id=$1 for update", [eventId]);
      const existing = await client.query<{ fact_revision_id: string; revision_no: number }>("select fact_revision_id,revision_no from news_core.fact_revisions where fact_event_id=$1 and logical_fingerprint=$2", [eventId, logicalFingerprint]);
      if (existing.rowCount) { await client.query("rollback"); return { inserted: false, factEventId: eventId, factRevisionId: existing.rows[0].fact_revision_id, revisionNo: existing.rows[0].revision_no, logicalFingerprint }; }
      const latest = await client.query<{ as_known_at: Date }>("select as_known_at from news_core.fact_revisions where fact_event_id=$1 and finalized_at is not null order by revision_no desc limit 1", [eventId]);
      if (input.relation) {
        const related = await client.query<{ fact_event_id: string; as_known_at: Date }>("select fact_event_id,as_known_at from news_core.fact_revisions where fact_revision_id=$1 and finalized_at is not null", [input.relation.relatedRevisionId]);
        if (related.rowCount !== 1 || instant(related.rows[0].as_known_at.toISOString()) > serverNow) throw new Error("NEWS_FACT_RELATION_INVALID");
      }
      const revisionNo = latest.rowCount ? Number((await client.query<{ n: number }>("select revision_no n from news_core.fact_revisions where fact_event_id=$1 order by revision_no desc limit 1", [eventId])).rows[0].n) + 1 : 1;
      const revisionId = `${eventId}:revision:${revisionNo}`;
      await client.query("insert into news_core.fact_revisions(fact_revision_id,fact_event_id,revision_no,logical_fingerprint,rule_set_version,claim_type,statement,subject_ref,object_ref,occurred_at,scheduled_for,confirmation_status,lifecycle_status,polarity,focal_claim_key,publication_revision_id,quality_flags,supersedes_revision_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)", [revisionId,eventId,revisionNo,logicalFingerprint,input.proposal.ruleSetVersion,input.proposal.claimType,input.proposal.statement,input.proposal.subjectRef,input.proposal.objectRef,input.proposal.occurredAt,input.proposal.scheduledFor,input.corroboration.confirmationStatus,input.corroboration.lifecycleStatus,input.corroboration.polarity,input.corroboration.claimKey,input.proposal.publicationRevisionId, JSON.stringify(input.proposal.qualityFlags), latest.rowCount ? `${eventId}:revision:${revisionNo - 1}` : null]);
      for (const evidence of input.evidence) await client.query("insert into news_core.fact_revision_evidence values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [revisionId,evidence.evidenceId,evidence.evidenceKind,evidence.claimKey,evidence.publicationRevisionId,evidence.sourceDocumentRef,evidence.contentLocator,evidence.provenanceRef,evidence.asKnownAt]);
      for (const dependency of input.dependencies) await client.query("insert into news_core.fact_revision_dependencies values ($1,$2,$3,$4)", [revisionId,dependency.dependencyType,dependency.dependencyRef,dependency.asKnownAt]);
      await client.query("insert into news_core.fact_revision_publications values ($1,$2,'FOCAL',$3)", [revisionId,input.proposal.publicationRevisionId,input.proposal.dependencyAsKnownAt]);
      if (input.relation) await client.query("insert into news_core.fact_revision_relations values ($1,$2,$3,$4)", [revisionId,input.relation.relatedRevisionId,input.relation.relationType,input.proposal.dependencyAsKnownAt]);
      await client.query("select * from news_core.finalize_fact_revision($1)", [revisionId]);
      if (failurePoint === "before-commit") throw new Error("INJECTED_FAILURE_BEFORE_COMMIT");
      await client.query("commit");
      if (failurePoint === "after-commit") throw new Error("INJECTED_FAILURE_AFTER_COMMIT");
      return { inserted: true, factEventId: eventId, factRevisionId: revisionId, revisionNo, logicalFingerprint };
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
}
