export type DiagnosticStage =
  | "configuration"
  | "gemini_api"
  | "workers_ai"
  | "response_validation"
  | "database"
  | "vectorize"
  | "unknown";

export class RuntimeDiagnosticError extends Error {
  readonly code: string;
  readonly stage: DiagnosticStage;
  override readonly cause: unknown;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: string,
    stage: DiagnosticStage,
    message: string,
    cause?: unknown,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RuntimeDiagnosticError";
    this.code = code;
    this.stage = stage;
    this.cause = cause;
    this.details = details;
  }
}

function messageFrom(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "An unknown runtime error occurred.";
}

function issuesFrom(error: unknown) {
  return (
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray(error.issues)
      ? error.issues.slice(0, 8).map((issue) => {
          if (!issue || typeof issue !== "object") return String(issue);
          const path =
            "path" in issue && Array.isArray(issue.path)
              ? issue.path.join(".")
              : "value";
          const message =
            "message" in issue && typeof issue.message === "string"
              ? issue.message
              : "Invalid value";
          return path + ": " + message;
        })
      : undefined
  );
}

export function diagnosticDetails(error: unknown) {
  const issues = issuesFrom(error);

  if (error instanceof RuntimeDiagnosticError) {
    return {
      code: error.code,
      stage: error.stage,
      message: error.message,
      cause: error.cause ? messageFrom(error.cause) : undefined,
      issues: issuesFrom(error.cause) ?? issues,
      details: error.details,
    };
  }

  return {
    code: "UNEXPECTED_ERROR",
    stage: "unknown" as const,
    message: messageFrom(error),
    issues,
  };
}

export function requestIdFor(request: Request) {
  return request.headers.get("cf-ray") || crypto.randomUUID();
}

export function logRuntimeEvent(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
) {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    service: "magic-catalog",
    event,
    ...fields,
  });
  console[level](payload);
}
