/**
 * Minimal HTTP request interface for @nestarc/tenancy public API.
 *
 * This adapter-neutral shape describes the fields used by extractors and
 * callbacks. The actual fields depend on the HTTP adapter and middleware;
 * compatible types alone do not verify an adapter's middleware integration.
 * Narrow platform-specific properties before use, or assert the request type
 * after selecting that adapter (e.g., `request as import('express').Request`).
 * Authentication and cookie properties require the corresponding middleware.
 */
export interface TenancyRequest {
  /** HTTP request headers. Keys are lowercase in Node.js. */
  headers: Record<string, string | string[] | undefined>;
  /** Hostname derived from the `Host` header. */
  hostname?: string;
  /** Adapter-provided request path, preferred by PathTenantExtractor. */
  path?: string;
  /** Request target such as `/api/users?page=1`; used when `path` is absent or empty. */
  url?: string;
  /** Index signature for platform-specific properties. Use type assertion to access. */
  [key: string]: unknown;
}

/**
 * Minimal HTTP response interface for @nestarc/tenancy public API.
 *
 * Used only in the `onTenantNotFound` callback. Available methods depend on
 * the HTTP adapter; for example, raw Node responses do not expose `status`
 * or `json`, and Fastify replies use `send` instead of `json`.
 *
 * The named methods are optional to maintain compatibility with any
 * response-like object. After selecting an adapter, assert its response type
 * to use its full API: `(response as import('express').Response)`. A callback
 * that handles a missing tenant must actually send a response or throw;
 * optional calls alone do not establish that a response was sent.
 */
export interface TenancyResponse {
  /** Set HTTP status code. Returns `this` for chaining (Express/Fastify convention). */
  status?(code: number): this;
  /** Send JSON response body. */
  json?(body: unknown): void;
  /** End the response without a body. */
  end?(): void;
  /** Index signature for platform-specific properties. Use type assertion to access. */
  [key: string]: unknown;
}
