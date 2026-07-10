import type { Response } from 'express';

export interface SseChannel {
  send(event: object): void;
  /** Sends a final frame (if given) and closes. Safe to call more than once. */
  finish(event?: object): void;
}

/** Opens a text/event-stream and runs `onClose` when the client goes away. */
export function openSse(res: Response, onClose: () => void): SseChannel {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let finished = false;

  res.on('close', () => {
    finished = true;
    onClose();
  });

  return {
    send(event: object) {
      if (!finished) res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    finish(event?: object) {
      if (finished) return;
      if (event) res.write(`data: ${JSON.stringify(event)}\n\n`);
      finished = true;
      res.end();
    },
  };
}
