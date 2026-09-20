import { handleRequest } from "@/server/router";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleRequest(req);
}
