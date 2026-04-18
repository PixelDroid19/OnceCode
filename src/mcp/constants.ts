/**
 * MCP (Model Context Protocol) constants.
 *
 * Centralises timeout values, protocol version strings, and other
 * configuration knobs used by the stdio and HTTP client implementations.
 */

import { APP_VERSION } from '@/constants.js'

/** Protocol version negotiated during the MCP initialize handshake. */
export const MCP_PROTOCOL_VERSION = '2024-11-05'

/** Client info payload sent during every MCP initialize request. */
export const MCP_CLIENT_INFO = {
  name: 'oncecode',
  version: APP_VERSION,
} as const

/** Timeout (ms) for a full MCP initialize handshake. */
export const MCP_INITIALIZE_TIMEOUT_MS = 10_000

/**
 * Shorter timeout (ms) used for the first probe attempt when the
 * framing protocol is auto-detected. If this expires the client
 * retries with {@link MCP_INITIALIZE_TIMEOUT_MS} before falling back.
 */
export const MCP_INITIALIZE_PROBE_TIMEOUT_MS = 1_200

/** Default timeout (ms) for regular MCP tool/resource/prompt requests. */
export const MCP_REQUEST_TIMEOUT_MS = 5_000

/** Timeout (ms) for lightweight listing operations (resources, prompts). */
export const MCP_LIST_TIMEOUT_MS = 3_000

/** Timeout (ms) for single-resource read / prompt-get calls. */
export const MCP_READ_TIMEOUT_MS = 5_000

/** Timeout (ms) for fire-and-forget MCP notifications over HTTP. */
export const MCP_NOTIFY_TIMEOUT_MS = 2_000
