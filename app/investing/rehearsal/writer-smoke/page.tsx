import { notFound } from "next/navigation";
import { isWriterHttpRehearsalEnabled } from "@/investing-core/server/writerHttpRehearsalGate";
import WriterSmokeClient from "./WriterSmokeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function Page() {
  if (!isWriterHttpRehearsalEnabled(process.env)) notFound();
  return <WriterSmokeClient />;
}
