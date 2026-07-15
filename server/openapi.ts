/** Minimal OpenAPI 3 document for core HTTP APIs (not WS). */
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
      '/api/health': {
        get: { summary: 'Health summary', responses: { '200': { description: 'OK' } } },
      },
      '/api/health/live': {
        get: { summary: 'Liveness', responses: { '200': { description: 'Alive' } } },
      },
      '/api/health/ready': {
        get: {
          summary: 'Readiness',
          responses: { '200': { description: 'Ready' }, '503': { description: 'Not ready' } },
        },
      },
      '/api/ice': {
        get: { summary: 'ICE servers (STUN/TURN)', responses: { '200': { description: 'ICE config' } } },
      },
      '/api/auth/register': {
        post: { summary: 'Register', responses: { '201': { description: 'Created' } } },
      },
      '/api/auth/login': {
        post: { summary: 'Login', responses: { '200': { description: 'Session token' } } },
      },
      '/api/auth/logout': {
        post: {
          summary: 'Logout',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'OK' } },
        },
      },
      '/api/auth/me': {
        get: {
          summary: 'Current user',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'User' } },
        },
      },
      '/api/auth/refresh': {
        post: {
          summary: 'Refresh session token',
          security: [{ bearerAuth: [] }],
          responses: { '200': { description: 'New token' } },
        },
      },
      '/api/auth/verify-email': {
        post: { summary: 'Verify email token', responses: { '200': { description: 'OK' } } },
      },
      '/api/blocks': {
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
      '/api/reports': {
        post: { summary: 'Submit report', responses: { '200': { description: 'OK' } } },
      },
      '/api/admin/overview': {
        get: {
          summary: 'Admin overview',
          parameters: [{ name: 'x-admin-key', in: 'header', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Metrics' } },
        },
      },
      '/api/metrics': {
        get: { summary: 'JSON metrics', responses: { '200': { description: 'Counters' } } },
      },
      '/api/metrics/prometheus': {
        get: { summary: 'Prometheus text', responses: { '200': { description: 'text/plain' } } },
      },
      '/api/docs': {
        get: { summary: 'This OpenAPI document', responses: { '200': { description: 'OpenAPI JSON' } } },
      },
      '/api/ratings': {
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
