export class RuntimeUnavailableError extends Error {
  readonly code = "RUNTIME_UNAVAILABLE";
  constructor(message = "The Agentic Hub runtime is not connected.") {
    super(message);
    this.name = "RuntimeUnavailableError";
  }
}

export class NotImplementedYetError extends Error {
  readonly code = "NOT_IMPLEMENTED_YET";
  constructor(feature: string) {
    super(`${feature} is waiting on the backend contract and is not available yet.`);
    this.name = "NotImplementedYetError";
  }
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Something went wrong.";
}

export function isUnavailable(error: unknown) {
  return error instanceof RuntimeUnavailableError || (error as { code?: string })?.code === "RUNTIME_UNAVAILABLE";
}
