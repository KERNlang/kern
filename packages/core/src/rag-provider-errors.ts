export type RagEmbeddingProviderErrorCode =
  | 'provider-auth'
  | 'provider-configuration'
  | 'provider-dimension-mismatch'
  | 'provider-model-not-found'
  | 'provider-rate-limit'
  | 'provider-unavailable';

export interface RagEmbeddingProviderErrorOptions {
  readonly providerId: string;
  readonly code: RagEmbeddingProviderErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export class RagEmbeddingProviderError extends Error {
  readonly providerId: string;
  readonly code: RagEmbeddingProviderErrorCode;

  constructor(options: RagEmbeddingProviderErrorOptions) {
    super(options.message);
    this.name = 'RagEmbeddingProviderError';
    this.providerId = options.providerId;
    this.code = options.code;
    if (options.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
  }
}

export class RagEmbeddingProviderAuthError extends RagEmbeddingProviderError {
  constructor(providerId: string, message: string, cause?: unknown) {
    super({ providerId, code: 'provider-auth', message, ...(cause !== undefined ? { cause } : {}) });
    this.name = 'RagEmbeddingProviderAuthError';
  }
}

export class RagEmbeddingProviderConfigurationError extends RagEmbeddingProviderError {
  constructor(providerId: string, message: string, cause?: unknown) {
    super({ providerId, code: 'provider-configuration', message, ...(cause !== undefined ? { cause } : {}) });
    this.name = 'RagEmbeddingProviderConfigurationError';
  }
}

export class RagEmbeddingProviderDimensionMismatchError extends RagEmbeddingProviderError {
  readonly expectedDims: number;
  readonly actualDims: number;

  constructor(providerId: string, message: string, expectedDims: number, actualDims: number, cause?: unknown) {
    super({
      providerId,
      code: 'provider-dimension-mismatch',
      message,
      ...(cause !== undefined ? { cause } : {}),
    });
    this.name = 'RagEmbeddingProviderDimensionMismatchError';
    this.expectedDims = expectedDims;
    this.actualDims = actualDims;
  }
}

export class RagEmbeddingProviderModelNotFoundError extends RagEmbeddingProviderError {
  readonly model: string;

  constructor(providerId: string, model: string) {
    super({
      providerId,
      code: 'provider-model-not-found',
      message: `RAG embedding provider '${providerId}' does not support model '${model}'.`,
    });
    this.name = 'RagEmbeddingProviderModelNotFoundError';
    this.model = model;
  }
}

export class RagEmbeddingProviderRateLimitError extends RagEmbeddingProviderError {
  constructor(providerId: string, message: string, cause?: unknown) {
    super({ providerId, code: 'provider-rate-limit', message, ...(cause !== undefined ? { cause } : {}) });
    this.name = 'RagEmbeddingProviderRateLimitError';
  }
}

export class RagEmbeddingProviderUnavailableError extends RagEmbeddingProviderError {
  constructor(providerId: string, message: string, cause?: unknown) {
    super({ providerId, code: 'provider-unavailable', message, ...(cause !== undefined ? { cause } : {}) });
    this.name = 'RagEmbeddingProviderUnavailableError';
  }
}
