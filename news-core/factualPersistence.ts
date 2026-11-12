import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ClassificationProposalV1 } from "./factualClassification";
import type { CorroborationResultV1 } from "./evidenceCorroboration";

export type FactualDependencyV1 = Readonly<{ dependencyType: "N2_PUBLICATION_REVISION" | "N3A_PROPOSAL" | "N3B_EVALUATION" | "FACT_REVISION"; dependencyRef: string; asKnownAt: string }>;
export type FactualEvidenceRefV1 = Readonly<{ evidenceId: string; evidenceKind: "N3A_PROPOSAL" | "N3B_EVIDENCE" | "N3B_PROOF"; claimKey: string; publicationRevisionId: string; sourceDocumentRef: string; contentLocator: string; provenanceRef: string; asKnownAt: string }>;
export type FactualRelationV1 = Readonly<{ relatedRevisionId: string; relationType: "CORRECTS" | "CONTESTS" | "RETRACTS" }>;
export type PersistFactualInputV1 = Readonly<{ canonicalClaimId: string; proposal: ClassificationProposalV1; corroboration: CorroborationResultV1; evidence: readonly FactualEvidenceRefV1[]; dependencies: readonly FactualDependencyV1[]; relation?: FactualRelationV1; }>;
export type PersistFactualResultV1 = Readonly<{ inserted: boolean; factEventId: string; factRevisionId: string | null; revisionNo: number | null; logicalFingerprint: string }>;
export type FactAsOfRowV1 = Readonly<{ factEventId: string; factRevisionId: string; revisionNo: number; canonicalClaimId: string; category: string; claimType: string; statement: string; occurredAt: string | null; scheduledFor: string | null; confirmationStatus: string; lifecycleStatus: string; polarity: string; asKnownAt: string; committedAt: string }>;

const stable = (value: unknown): string => { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; return `{${Object.keys(value as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`; };
const fingerprint = (input: PersistFactualInputV1): string => createHash("sha256").update(stable({ canonicalClaimId: input.canonicalClaimId, proposal: { ...input.proposal, proposedAt: undefined }, corroboration: { ...input.corroboration, evaluatedAt: undefined }, evidence: [...input.evidence].sort((a,b) => a.evidenceId.localeCompare(b.evidenceId)), dependencies: [...input.dependencies].sort((a,b) => `${a.dependencyType}:${a.dependencyRef}`.localeCompare(`${b.dependencyType}:${b.dependencyRef}`)), relation: input.relation ?? null })).digest("hex");
const instant = (value: string): number => { const result = Date.parse(value); if (!Number.isFinite(result)) throw new Error("NEWS_FACT_TIMESTAMP_INVALID"); return result; };

export class PostgresFactualStore {
  constructor(private readonly pool: Pool) {}
  async close(): Promise<void> { await this.pool.end(); }

  async persist(input: PersistFactualInputV1, failurePoint: "none" | "before-commit" = "none"): Promise<PersistFactualResultV1> {
    const logicalFingerprint = fingerprint(input);
    if (!input.canonicalClaimId || input.proposal.publicationRevisionId === "" || input.evidence.length === 0) throw new Error("NEWS_FACT_INPUT_INVALID");
    if (input.proposal.occurredAt && input.proposal.scheduledFor) throw new Error("NEWS_FACT_TEMPORAL_FIELDS_CONFLICT");
    const known = instant(input.proposal.dependencyAsKnownAt);
    for (const dependency of input.dependencies) if (!dependency.dependencyRef || instant(dependency.asKnownAt) > known) throw new Error("NEWS_FACT_FUTURE_DEPENDENCY");
    for (const evidence of input.evidence) if (instant(evidence.asKnownAt) > known) throw new Error("NEWS_FACT_FUTURE_EVIDENCE");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const publication = await client.query<{ source_document_ref: string; as_known_at: Date }>("select source_document_ref,as_known_at from news_core.publication_revisions where publication_revision_id=$1 and visibility_state='COMMITTED'", [input.proposal.publicationRevisionId]);
      if (publication.rowCount !== 1 || instant(input.proposal.dependencyAsKnownAt) < instant(publication.rows[0].as_known_at.toISOString())) throw new Error("NEWS_FACT_PUBLICATION_REVISION_INVALID");
      for (const evidence of input.evidence) {
        const revision = await client.query<{ source_document_ref: string; as_known_at: Date }>("select source_document_ref,as_known_at from news_core.publication_revisions where publication_revision_id=$1 and visibility_state='COMMITTED'", [evidence.publicationRevisionId]);
        if (revision.rowCount !== 1 || revision.rows[0].source_document_ref !== evidence.sourceDocumentRef || instant(evidence.asKnownAt) < instant(revision.rows[0].as_known_at.toISOString())) throw new Error("NEWS_FACT_EVIDENCE_REFERENCE_INVALID");
      }
      const event = await client.query<{ fact_event_id: string }>("insert into news_core.fact_events(fact_event_id,canonical_claim_id,taxonomy_version,category) values ($1,$1,$2,$3) on conflict(canonical_claim_id) do update set canonical_claim_id=excluded.canonical_claim_id returning fact_event_id", [input.canonicalClaimId, input.proposal.taxonomyVersion, input.proposal.category]);
      const eventId = event.rows[0].fact_event_id;
      await client.query("select fact_event_id from news_core.fact_events where fact_event_id=$1 for update", [eventId]);
      const existing = await client.query<{ fact_revision_id: string; revision_no: number }>("select fact_revision_id,revision_no from news_core.fact_revisions where fact_event_id=$1 and logical_fingerprint=$2", [eventId, logicalFingerprint]);
      if (existing.rowCount) { await client.query("rollback"); return { inserted: false, factEventId: eventId, factRevisionId: existing.rows[0].fact_revision_id, revisionNo: existing.rows[0].revision_no, logicalFingerprint }; }
      const latest = await client.query<{ as_known_at: Date }>("select as_known_at from news_core.fact_revisions where fact_event_id=$1 order by revision_no desc limit 1", [eventId]);
      if (latest.rowCount && known < instant(latest.rows[0].as_known_at.toISOString())) throw new Error("NEWS_FACT_KNOWN_TIME_REGRESSION");
      if (input.relation) {
        const related = await client.query<{ fact_event_id: string; as_known_at: Date }>("select fact_event_id,as_known_at from news_core.fact_revisions where fact_revision_id=$1", [input.relation.relatedRevisionId]);
        if (related.rowCount !== 1 || instant(related.rows[0].as_known_at.toISOString()) > known) throw new Error("NEWS_FACT_RELATION_INVALID");
      }
      const revisionNo = latest.rowCount ? Number((await client.query<{ n: number }>("select revision_no n from news_core.fact_revisions where fact_event_id=$1 order by revision_no desc limit 1", [eventId])).rows[0].n) + 1 : 1;
      const revisionId = `${eventId}:revision:${revisionNo}`;
      await client.query("insert into news_core.fact_revisions(fact_revision_id,fact_event_id,revision_no,logical_fingerprint,rule_set_version,claim_type,statement,subject_ref,object_ref,occurred_at,scheduled_for,confirmation_status,lifecycle_status,polarity,focal_claim_key,publication_revision_id,as_known_at,quality_flags,supersedes_revision_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)", [revisionId,eventId,revisionNo,logicalFingerprint,input.proposal.ruleSetVersion,input.proposal.claimType,input.proposal.statement,input.proposal.subjectRef,input.proposal.objectRef,input.proposal.occurredAt,input.proposal.scheduledFor,input.corroboration.confirmationStatus,input.corroboration.lifecycleStatus,input.corroboration.polarity,input.corroboration.claimKey,input.proposal.publicationRevisionId, input.proposal.dependencyAsKnownAt, JSON.stringify(input.proposal.qualityFlags), latest.rowCount ? `${eventId}:revision:${revisionNo - 1}` : null]);
      for (const evidence of input.evidence) await client.query("insert into news_core.fact_revision_evidence values ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [revisionId,evidence.evidenceId,evidence.evidenceKind,evidence.claimKey,evidence.publicationRevisionId,evidence.sourceDocumentRef,evidence.contentLocator,evidence.provenanceRef,evidence.asKnownAt]);
      for (const dependency of input.dependencies) await client.query("insert into news_core.fact_revision_dependencies values ($1,$2,$3,$4)", [revisionId,dependency.dependencyType,dependency.dependencyRef,dependency.asKnownAt]);
      await client.query("insert into news_core.fact_revision_publications values ($1,$2,'FOCAL',$3)", [revisionId,input.proposal.publicationRevisionId,input.proposal.dependencyAsKnownAt]);
      if (input.relation) await client.query("insert into news_core.fact_revision_relations values ($1,$2,$3,$4)", [revisionId,input.relation.relatedRevisionId,input.relation.relationType,input.proposal.dependencyAsKnownAt]);
      if (failurePoint === "before-commit") throw new Error("INJECTED_FAILURE_BEFORE_COMMIT");
      await client.query("commit");
      return { inserted: true, factEventId: eventId, factRevisionId: revisionId, revisionNo, logicalFingerprint };
    } catch (error) { await client.query("rollback").catch(() => undefined); throw error; } finally { client.release(); }
  }

  async readAsOf(asOf: string): Promise<FactAsOfRowV1[]> {
    const result = await this.pool.query<FactAsOfRowV1>("select \"factEventId\",\"factRevisionId\",\"revisionNo\",\"canonicalClaimId\",category,\"claimType\",statement,\"occurredAt\",\"scheduledFor\",\"confirmationStatus\",\"lifecycleStatus\",polarity,\"asKnownAt\",\"committedAt\" from news_core.read_fact_revisions_as_of($1)", [asOf]);
    return result.rows;
  }
}
