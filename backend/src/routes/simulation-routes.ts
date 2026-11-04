import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { FastifyError, FastifyInstance, FastifyRequest } from 'fastify';
import { ApplicationError } from '../application/simulation/contracts.js';
import type { SimulationService } from '../application/simulation/simulation-service.js';
import { EventStream } from '../infrastructure/streaming/event-stream.js';
import { scenarioRegistry } from '../domain/narrative/scenarios/registry.js';
import { graphMetadata } from '../domain/simulation/graph-projection.js';
import { AiProviderError } from '../ai/errors.js';
import { RequestBudget } from './request-budget.js';
import { CreateRunSchema, CreateRunValidationSchema, EmptyQuery, ErrorResponses, EvaluationSchema, IdParams, ModelListSchema, RunSchema, ScenarioListSchema } from './simulation-schemas.js';

const loopback = (ip: string): boolean => ip === '::1' || ip.startsWith('127.') && isIP(ip) === 4 || ip.startsWith('::ffff:127.');

export interface SimulationRouteOptions {
  service: SimulationService;
  accessToken?: string;
  allowedOrigin?: string;
  models: () => readonly { providerId: string; modelId: string | null; configured: boolean }[];
}

export async function simulationRoutes(app: FastifyInstance, options: SimulationRouteOptions): Promise<void> {
  const streams = new EventStream();
  const repo = options.service.repository;
  const budget = new RequestBudget();
  const guard = (request: FastifyRequest): void => {
    if (!options.accessToken && !loopback(request.ip)) throw new ApplicationError('LOCAL_ACCESS_REQUIRED', 403);
    if (options.accessToken) {
      const header = request.headers.authorization ?? '';
      const expected = `Bearer ${options.accessToken}`;
      if (Buffer.byteLength(header) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
        throw new ApplicationError('ACCESS_DENIED', 401);
      }
    }
    const host = request.headers.host ?? '';
    let hostName: string;
    try {
      const parsed = new URL(`http://${host}`);
      if (parsed.username || parsed.password || parsed.host.toLowerCase() !== host.toLowerCase()) throw new Error();
      hostName = parsed.hostname;
    } catch { throw new ApplicationError('INVALID_HOST', 403); }
    if (!options.accessToken && !['localhost', '127.0.0.1', '[::1]'].includes(hostName)) {
      throw new ApplicationError('INVALID_HOST', 403);
    }
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== (options.allowedOrigin ?? `http://${host}`)) {
      throw new ApplicationError('CROSS_ORIGIN_DENIED', 403);
    }
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new ApplicationError('CROSS_ORIGIN_DENIED', 403);
    if (request.headers['sec-fetch-site'] === 'same-site' && origin === undefined) {
      throw new ApplicationError('CROSS_ORIGIN_DENIED', 403);
    }
    budget.accept(request.ip, request.method === 'POST' && request.routeOptions.url === '/api/v1/runs');
    const contentType = request.headers['content-type'];
    if (request.method === 'POST' && contentType && contentType.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      throw new ApplicationError('UNSUPPORTED_CONTENT_TYPE', 415);
    }
  };
  const authorizeRun = async (request: FastifyRequest<{ Params: { id: string } }>): Promise<void> => {
    const cookieName = `fourSightRun_${request.params.id}=`;
    const matches = request.headers.cookie?.split(';').map((part) => part.trim()).filter((part) => part.startsWith(cookieName)) ?? [];
    if (matches.length > 1) throw new ApplicationError('RUN_ACCESS_DENIED', 401);
    const cookie = matches[0]?.slice(cookieName.length);
    const token = request.headers['x-run-token'] ?? cookie;
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new ApplicationError('RUN_ACCESS_DENIED', 401);
    await repo.authorize(request.params.id, token);
  };
  app.addHook('onRequest', async (request) => guard(request));
  app.addHook('onSend', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
  app.addHook('preClose', async () => { streams.close(); });
  app.setErrorHandler((error, _request, reply) => {
    const httpError = error as FastifyError;
    let status = 500;
    let code = 'INTERNAL_SERVER_ERROR';
    if (error instanceof ApplicationError) { status = error.statusCode; code = error.code; }
    else if (error instanceof AiProviderError) { status = 503; code = error.code; }
    else if (httpError.validation) { status = 400; code = 'INVALID_REQUEST'; }
    else if (httpError.statusCode === 413) { status = 413; code = 'PAYLOAD_TOO_LARGE'; }
    else if (httpError.statusCode === 415) { status = 415; code = 'UNSUPPORTED_CONTENT_TYPE'; }
    else if (httpError.statusCode === 400) { status = 400; code = 'INVALID_REQUEST'; }
    void reply.code(status).send({ error: { code, message: code } });
  });

  app.get('/api/v1/scenarios', {
    schema: { querystring: EmptyQuery, response: { 200: ScenarioListSchema, ...ErrorResponses } },
  }, async () => ({ scenarios: scenarioRegistry.map(({ scenario, version, initialStates }) => ({ id: scenario.id, version, title: scenario.title,
    initialVariants: ['externalSource', 'protectedInternalSource'], graph: {
      externalSource: graphMetadata(scenario, initialStates.externalSource), protectedInternalSource: graphMetadata(scenario, initialStates.protectedInternalSource),
    } })) }));

  app.get('/api/v1/models', {
    schema: { querystring: EmptyQuery, response: { 200: ModelListSchema, ...ErrorResponses } },
  }, async () => ({ models: options.models() }));

  app.post<{ Body: { scenarioId: string; initialVariant: 'externalSource' | 'protectedInternalSource'; providerId?: string; modelId?: string | null; additionalContext?: string } }>('/api/v1/runs', {
    bodyLimit: 12288, schema: { body: CreateRunSchema, querystring: EmptyQuery,
      response: { 202: Type.Object({ run: RunSchema }), ...ErrorResponses } },
    preValidation: async (request) => {
      if (!Value.Check(CreateRunValidationSchema, request.body)) throw new ApplicationError('INVALID_REQUEST', 400);
    },
  }, async (request, reply) => {
    if ((request.body.providerId === undefined) !== (request.body.modelId === undefined)) throw new ApplicationError('INVALID_MODEL_SELECTION', 400);
    if (request.body.additionalContext?.trim()) throw new ApplicationError('UNSUPPORTED_ADDITIONAL_CONTEXT', 400);
    const selection = request.body.providerId === undefined ? undefined : {
      providerId: request.body.providerId, modelId: request.body.modelId ?? null,
      ...(request.body.additionalContext === undefined ? {} : { additionalContext: request.body.additionalContext }),
    };
    const result = await options.service.create(request.body.scenarioId, request.body.initialVariant, selection);
    const secureCookie = request.protocol === 'https' || options.allowedOrigin?.startsWith('https://');
    reply.header('Set-Cookie', `fourSightRun_${result.run.id}=${result.accessToken}; HttpOnly; SameSite=Strict; Path=/api/v1/runs/${result.run.id}; Max-Age=604800${secureCookie ? '; Secure' : ''}`);
    return reply.code(202).send({ run: result.run });
  });

  app.get<{ Params: { id: string } }>('/api/v1/runs/:id', {
    schema: { params: IdParams, querystring: EmptyQuery, response: { 200: RunSchema, ...ErrorResponses } },
    preHandler: authorizeRun,
  }, async (request) => repo.read(request.params.id));

  for (const action of ['pause', 'resume', 'cancel'] as const) {
    app.post<{ Params: { id: string } }>(`/api/v1/runs/:id/${action}`, {
      bodyLimit: 128,
      schema: { params: IdParams, querystring: EmptyQuery, body: Type.Optional(EmptyQuery), response: { 200: RunSchema, ...ErrorResponses } },
      preValidation: async (request) => {
        if (request.body === undefined) request.body = {};
        if (!Value.Check(EmptyQuery, request.body)) throw new ApplicationError('INVALID_REQUEST', 400);
      },
      preHandler: authorizeRun,
    }, async (request) => options.service.control(request.params.id, action));
  }

  app.get<{ Params: { id: string } }>('/api/v1/runs/:id/result', {
    schema: { params: IdParams, querystring: EmptyQuery, response: { 200: Type.Object({ evaluation: EvaluationSchema, ruleAdherence: Type.Union([Type.Number(), Type.Null()]) }), ...ErrorResponses } },
    preHandler: authorizeRun,
  }, async (request) => {
    const run = await repo.read(request.params.id);
    if (!run.evaluation) throw new ApplicationError('RESULT_NOT_READY', 409);
    const count = run.evaluation.totalDecisions;
    return { evaluation: run.evaluation, ruleAdherence: count === 0 ? null : run.evaluation.approvedDecisions * 100 / count };
  });

  app.get<{ Params: { id: string }; Querystring: { after?: number } }>('/api/v1/runs/:id/events', {
    schema: { params: IdParams, querystring: Type.Object({ after: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })) }, { additionalProperties: false }), response: { 200: Type.String({ description: 'SSE frames containing committed AuditEventSchema records.' }), ...ErrorResponses } },
    preHandler: authorizeRun,
  }, async (request, reply) => {
    let after = request.query.after ?? 0;
    const last = request.headers['last-event-id'];
    if (last !== undefined) {
      if (typeof last !== 'string' || last.split(':').length !== 2 ||
          !last.startsWith(`${request.params.id}:`) || !/^\d{1,7}$/.test(last.split(':')[1] ?? '')) {
        throw new ApplicationError('INVALID_EVENT_CURSOR', 400);
      }
      after = Number(last.split(':')[1]);
    }
    const run = await repo.read(request.params.id);
    if (after > run.eventSequence) throw new ApplicationError('INVALID_EVENT_CURSOR', 400);
    streams.reserve(reply.raw, run.id);
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    reply.raw.flushHeaders();
    await streams.stream(repo, run.id, after, reply.raw, () => authorizeRun(request));
  });
}
