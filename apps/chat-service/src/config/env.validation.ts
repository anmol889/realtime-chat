import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(4100),
  INSTANCE_ID: Joi.string().default('chat-local'),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),
  /** GraphQL endpoint of user-service; used only at join time to verify the user exists. */
  USER_SERVICE_URL: Joi.string().uri().required(),
  /** Set to "false" to skip the user-service check (used by integration tests). */
  VERIFY_USERS: Joi.boolean().default(true),
});
