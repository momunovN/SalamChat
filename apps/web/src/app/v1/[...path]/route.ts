import { handleRequest } from "@/server/router";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function run(req: Request) {
  return handleRequest(req);
}

export const GET = run;
export const POST = run;
export const PATCH = run;
export const PUT = run;
export const DELETE = run;
export const OPTIONS = run;
