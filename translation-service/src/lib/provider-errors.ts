export type ProviderErrorCode =
  | "E_PROVIDER_AUTH"
  | "E_PROVIDER_TIMEOUT"
  | "E_PROVIDER_UNAVAILABLE"
  | "E_PROVIDER_MALFORMED_RESPONSE"
  | "E_PROVIDER_BAD_REQUEST"
  | "E_PROVIDER_NETWORK"
  | "E_PROVIDER_CONFIG";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly retriable: boolean;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options?: {
      status?: number;
      retriable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ProviderError";
    this.code = code;
    this.status = options?.status;
    this.retriable = options?.retriable ?? false;
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

export function providerErrorToHttpStatus(error: ProviderError) {
  switch (error.code) {
    case "E_PROVIDER_TIMEOUT":
      return 504;
    case "E_PROVIDER_BAD_REQUEST":
      return 502;
    case "E_PROVIDER_AUTH":
    case "E_PROVIDER_UNAVAILABLE":
    case "E_PROVIDER_MALFORMED_RESPONSE":
    case "E_PROVIDER_NETWORK":
    case "E_PROVIDER_CONFIG":
    default:
      return 502;
  }
}
