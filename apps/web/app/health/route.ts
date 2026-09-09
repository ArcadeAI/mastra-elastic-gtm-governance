/**
 * Same shape as the `/health` endpoints on `hooks` and `lead-app`, so the
 * Render blueprint can point all three services at one path.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", service: "web" });
}
