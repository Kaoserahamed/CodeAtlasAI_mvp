/**
 * Structured client logger.
 *
 * The shape is the contract: every entry has a timestamp, a level, a
 * component and a message. These assert that shape, because the value of
 * routing logging through one helper is that a console entry can be read the
 * same way a server log line can.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger, buildEntry } from './logger';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildEntry', () => {
  it('carries a timestamp, level, component and message', () => {
    const entry = buildEntry('error', 'api', 'request failed');

    expect(entry.level).toBe('error');
    expect(entry.component).toBe('api');
    expect(entry.message).toBe('request failed');
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
  });

  it('omits context entirely when none is supplied', () => {
    // An empty context object would be noise on every line.
    expect('context' in buildEntry('info', 'api', 'ok')).toBe(false);
  });

  it('omits context when it is empty', () => {
    expect('context' in buildEntry('info', 'api', 'ok', {})).toBe(false);
  });

  it('unwraps an Error into name, message and stack', () => {
    const entry = buildEntry('error', 'api', 'failed', { error: new Error('boom') });

    // Logging the Error directly would print nothing useful in some browsers.
    expect(entry.context?.error).toMatchObject({
      name: 'Error',
      message: 'boom',
    });
  });

  it('leaves a non-Error value alone', () => {
    const entry = buildEntry('error', 'api', 'failed', { status: 500 });
    expect(entry.context?.status).toBe(500);
  });

  it('preserves every key the caller attached', () => {
    const entry = buildEntry('warn', 'api', 'slow', { path: '/graph', ms: 1200 });
    expect(entry.context).toEqual({ path: '/graph', ms: 1200 });
  });
});

describe('logger', () => {
  it('writes to console.error for the error level', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.error('api', 'failed', { status: 500 });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('prefixes the line so the level is visible without opening the object', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.error('api', 'request failed', { status: 500 });

    const [line, context] = spy.mock.calls[0];
    expect(String(line)).toContain('[error]');
    expect(String(line)).toContain('api');
    expect(String(line)).toContain('request failed');
    expect(context).toEqual({ status: 500 });
  });

  it('routes each level to the matching console method', () => {
    const debug = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logger.debug('api', 'd');
    logger.warn('api', 'w');

    expect(debug).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never leaks the raw Error into the message line', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logger.error('App', 'analysis failed', { error: new Error('clone failed') });

    // The message stays readable; the detail lives in the context object.
    expect(String(spy.mock.calls[0][0])).toBe('[error] App: analysis failed');
  });
});