import { getDb } from "@/lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;
  const row = getDb().prepare("SELECT avatar FROM users WHERE id = ?").get(userId) as
    { avatar: string | null } | undefined;
  if (!row?.avatar) return new Response(null, { status: 404 });
  const match = row.avatar.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return new Response(null, { status: 404 });
  const contentType = match[1] === "jpeg" ? "image/jpeg" : `image/${match[1]}`;
  return new Response(Buffer.from(match[2], "base64"), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
