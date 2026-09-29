import { UserError } from "./errors";

export function isAllowedOrigin(
  origin: string | null | undefined,
  host: string | null | undefined,
) {
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (process.env.POKER_PUBLIC_ORIGIN)
      return parsed.origin === new URL(process.env.POKER_PUBLIC_ORIGIN).origin;
    return parsed.host === host;
  } catch {
    return false;
  }
}

export function assertMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (
    (origin &&
      !isAllowedOrigin(origin, request.headers.get("host") ?? new URL(request.url).host)) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new UserError("不允许跨站操作", 403);
  }
}
