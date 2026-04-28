import pino from 'pino';
import { config } from '@/config';

const buildTransport = () => {
  if (config.nodeEnv !== 'development') return undefined;
  try {
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    };
  } catch {
    return undefined;
  }
};

export const logger = pino({
  level: config.nodeEnv === 'development' ? 'debug' : 'info',
  transport: buildTransport(),
});

export const auditLogger = pino({
  level: 'info',
  name: 'audit',
});
