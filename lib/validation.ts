import { UserError } from "./errors";

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new UserError("请求格式无效");
  return value as Record<string, unknown>;
}

export function text(value: unknown, label: string, maxLength = 80): string {
  if (typeof value !== "string" || !value.length || value.length > maxLength)
    throw new UserError(`${label}格式无效`);
  return value;
}

export function integer(
  value: unknown,
  label: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new UserError(`${label}须为 ${min} 到 ${max} 的整数`);
  return value;
}

export function optionalBoolean(value: unknown): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") throw new UserError("选项格式无效");
  return value;
}
