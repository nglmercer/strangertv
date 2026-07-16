/** Minimal OpenAPI 3 document for core HTTP APIs (not WS). */
import { API_ROUTES } from '../shared/constants'

export function openApiDocument(appUrl: string) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'stranger API',
      version: '1.0.0',
      description: 'HTTP API for stranger video chat. WebSocket signaling is at /ws.',
    },
    servers: [{ url: appUrl }],
    paths: {
      [API_ROUTES.health]: {
        get: { summary: 'Health summary', responses: { '200': { description: 'OK' } } },
      },
      [API_ROUTES.healthLive]: {
        get: { summary: 'Liveness', responses: { '200': { description: 'Alive' } } },
      },
      [API_ROUTES.healthReady]: {
        get: {
          summary: 'Readiness',
          responses: { '200': { description: 'Ready' }, '503': { description: 'Not ready' } },
        },
      },
      [API_ROUTES.ice]: {
        get: { summary: 'ICE servers (STUN/TURN)', responses: { '200': { description: 'ICE config' } } },
      },
      [API_ROUTES.authRegister]: {
        post: { summary: 'Register', responses: { '201': { description: 'Created' } } },
      },
      [API_ROUTES.authLogin]: {
        post: { summary: 'Login', responses: { '200': { description: 'Session token' } } },
      },
      [API_ROUTES.authLogout]: {
        post: {
          summary: 'Logout',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'OK' } },
        },
      },
      [API_ROUTES.authMe]: {
        get: {
          summary: 'Current user',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'User' } },
        },
      },
      [API_ROUTES.authRefresh]: {
        post: {
          summary: 'Refresh session token',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'New token' } },
        },
      },
      [API_ROUTES.authVerifyEmail]: {
        post: { summary: 'Verify email token', responses: { '200': { description: 'OK' } } },
      },
      [API_ROUTES.blocks]: {
        get: {
          summary: 'List blocks',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'Blocked users' } },
        },
        post: {
          summary: 'Block user by id',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'OK' } },
        },
      },
      [API_ROUTES.reports]: {
        post: { summary: 'Submit report', responses: { '200': { description: 'OK' } } },
      },
      [API_ROUTES.adminOverview]: {
        get: {
          summary: 'Admin overview',
          parameters: [{ name: 'x-admin-key', in: 'header', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Metrics' } },
        },
      },
      [API_ROUTES.metrics]: {
        get: { summary: 'JSON metrics', responses: { '200': { description: 'Counters' } } },
      },
      [API_ROUTES.metricsPrometheus]: {
        get: { summary: 'Prometheus text', responses: { '200': { description: 'text/plain' } } },
      },
      [API_ROUTES.docs]: {
        get: { summary: 'This OpenAPI document', responses: { '200': { description: 'OpenAPI JSON' } } },
      },
      [API_ROUTES.ratings]: {
        post: {
          summary: 'Rate a match (1–5)',
          responses: { '200': { description: 'OK' } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
  }
}
