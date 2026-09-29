import { NextResponse } from "next/server";
import { UserError, publicError } from "./errors";
import { assertMutationOrigin } from "./request-security";
import { object } from "./validation";

export async function readJson(request: Request, maxBytes = 32 * 1024) {
  assertMutationOrigin(request);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new UserError("请使用 JSON 请求", 415);
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new UserError("请求内容过大", 413);
  if (!request.body) throw new UserError("请求内容为空");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new UserError("请求内容过大", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new UserError("JSON 格式无效");
  }
  return object(parsed);
}

export function errorResponse(error: unknown, fallback: string) {
  const problem = publicError(error, fallback);
  return NextResponse.json({ error: problem.message }, { status: problem.status });
}
