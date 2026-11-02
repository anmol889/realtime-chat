import * as Joi from 'joi';

/** Fail fast at boot if the environment is incomplete; avoids half-working instances behind the LB. */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(4000),
  INSTANCE_ID: Joi.string().default('user-local'),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),
});
