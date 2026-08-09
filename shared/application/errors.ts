export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "DEPENDENCY_UNAVAILABLE"
  | "DOMAIN_ERROR"
  | "INTERNAL_ERROR";

export class ApplicationError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[]>;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string, details?: Record<string, string[]>) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}

export class AuthenticationError extends ApplicationError {
  constructor(message = "Authentication is required.") {
    super("AUTHENTICATION_REQUIRED", message, 401);
  }
}

export class AuthorizationError extends ApplicationError {
  constructor(message = "You are not allowed to perform this operation.") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message = "The requested resource was not found.") {
    super("NOT_FOUND", message, 404);
  }
}

export class ConflictError extends ApplicationError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
  }
}

export class RateLimitError extends ApplicationError {
  readonly retryAt: number;

  constructor(message: string, retryAt: number) {
    super("RATE_LIMITED", message, 429);
    this.retryAt = retryAt;
  }
}

export class DependencyUnavailableError extends ApplicationError {
  constructor(message: string) {
    super("DEPENDENCY_UNAVAILABLE", message, 503);
  }
}

export class DomainError extends ApplicationError {
  constructor(message: string, status = 422) {
    super("DOMAIN_ERROR", message, status);
  }
}

export function normalizeApplicationError(error: unknown, fallback = "An unexpected error occurred.") {
  if (error instanceof ApplicationError) return error;
  if (error instanceof Error && error.message.includes("Unauthorized")) {
    return new AuthorizationError();
  }
  return new ApplicationError("INTERNAL_ERROR", fallback, 500);
}
