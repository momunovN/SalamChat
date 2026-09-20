import { handleRequest } from "@/server/router";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleRequest(req);
}
