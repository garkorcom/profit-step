/**
 * Tests for HTTP error → JSON mapping (`tasktotimeErrorHandler`).
 *
 * Pin the contract that domain validation errors (`InvalidDraft`,
 * `PreconditionFailed`, `MaxHierarchyDepth`, `SelfDependency`) surface as
 * 400 — per spec/03-state-machine/transitions.md §"ready()" ("else 400").
 * Without this mapping `InvalidDraft` defaulted to 500 and the spec would
 * be silently violated for the entire `transition` endpoint.
 */

import type { Request, Response, NextFunction } from 'express';

import { tasktotimeErrorHandler } from '../../../adapters/http/middleware';
import {
  InvalidDraft,
  PreconditionFailed,
  TransitionNotAllowed,
  TaskNotFound,
  MaxHierarchyDepth,
  SelfDependency,
} from '../../../domain/errors';
import { asTaskId } from '../../../domain/identifiers';

function makeRes(): {
  res: Response;
  status: jest.Mock;
  json: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const res = {
    status,
    headersSent: false,
  } as unknown as Response;
  return { res, status, json };
}

describe('tasktotimeErrorHandler — domain error mapping', () => {
  const req = {} as Request;
  const next = (() => {}) as NextFunction;

  test('InvalidDraft → 400 with code=InvalidDraft', () => {
    const { res, status, json } = makeRes();
    const err = new InvalidDraft(
      ['assignedTo', 'dueAt'],
      asTaskId('task_x'),
    );
    tasktotimeErrorHandler(err, req, res, next);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      ok: false,
      error: expect.objectContaining({ code: 'InvalidDraft' }),
    });
  });

  test('PreconditionFailed → 400', () => {
    const { res, status } = makeRes();
    const err = new PreconditionFailed('block requires reason');
    tasktotimeErrorHandler(err, req, res, next);
    expect(status).toHaveBeenCalledWith(400);
  });

  test('MaxHierarchyDepth → 400', () => {
    const { res, status } = makeRes();
    const err = new MaxHierarchyDepth(asTaskId('task_y'));
    tasktotimeErrorHandler(err, req, res, next);
    expect(status).toHaveBeenCalledWith(400);
  });

  test('SelfDependency → 400', () => {
    const { res, status } = makeRes();
    const err = new SelfDependency(asTaskId('task_z'));
    tasktotimeErrorHandler(err, req, res, next);
    expect(status).toHaveBeenCalledWith(400);
  });

  test('TransitionNotAllowed stays 409 (regression check)', () => {
    const { res, status } = makeRes();
    const err = new TransitionNotAllowed('draft', 'start', asTaskId('task_q'));
    tasktotimeErrorHandler(err, req, res, next);
    expect(status).toHaveBeenCalledWith(409);
  });

  test('TaskNotFound stays 404 (regression check)', () => {
    const { res, status } = makeRes();
    const err = new TaskNotFound(asTaskId('task_missing'));
    tasktotimeErrorHandler(err, req, res, next);
    expect(status).toHaveBeenCalledWith(404);
  });
});
