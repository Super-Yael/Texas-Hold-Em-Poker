export class UserError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "UserError";
  }
}

export function publicError(error: unknown, fallback: string) {
  if (error instanceof UserError) return { message: error.message, status: error.status };
  console.error(fallback, error);
  return { message: fallback, status: 500 };
}
