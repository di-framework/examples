import { z } from 'zod';

export const modelSpecSchema = z
  .strictObject({
    name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/),
    task: z.enum(['classification', 'regression', 'embedding']),
    datasetPath: z.string().min(1),
    datasetRevision: z.string().min(1),
    source: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('mlp'),
        hidden: z.array(z.number().int().min(1).max(512)).max(4).default([16]),
      }),
      z.strictObject({
        kind: z.literal('pretrained'),
        path: z.string().min(1),
        revision: z.string().min(1),
        tokenizerPath: z.string().optional(),
      }),
    ]),
    inputName: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_./:-]*$/)
      .default('input'),
    outputName: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_./:-]*$/)
      .default('output'),
    inputSize: z.number().int().min(1).max(1024),
    outputSize: z.number().int().min(1).max(128),
    outputEncoding: z.enum(['logits', 'probabilities', 'values', 'embedding']),
    pooling: z.enum(['none', 'mean', 'cls', 'last-token']).default('none'),
    standardize: z.boolean().default(false),
    seed: z
      .number()
      .int()
      .min(0)
      .max(2 ** 32 - 1)
      .default(42),
    validationFraction: z.number().min(0.1).max(0.3).default(0.2),
    testFraction: z.number().min(0.1).max(0.3).default(0.2),
    maxSteps: z.number().int().min(1).max(100_000).default(400),
    batchSize: z.number().int().min(1).max(256).default(8),
    learningRates: z.array(z.number().positive().max(1)).min(1).max(3).default([0.01]),
    trainable: z.array(z.string().min(1)).default([]),
    budgetSeconds: z.number().int().min(1).max(86_400).default(600),
    target: z.strictObject({
      metric: z.enum(['accuracy', 'mse', 'recallAt1']),
      value: z.number().finite().nonnegative(),
    }),
  })
  .superRefine((spec, context) => {
    const fail = (message: string) => context.addIssue({ code: 'custom', message });
    const metric = {
      classification: 'accuracy',
      regression: 'mse',
      embedding: 'recallAt1',
    }[spec.task];
    if (spec.target.metric !== metric) fail(`Use ${metric} for ${spec.task}`);
    if (metric !== 'mse' && spec.target.value > 1)
      fail('Accuracy/recall targets must be between 0 and 1');
    if (
      spec.task === 'embedding' &&
      (spec.source.kind !== 'pretrained' || spec.outputEncoding !== 'embedding')
    )
      fail('Embeddings require a compatible pretrained model and embedding output');
    if (spec.task === 'embedding' && spec.standardize) fail('Token IDs cannot be standardized');
    if (spec.task !== 'embedding' && spec.pooling !== 'none')
      fail('Pooling applies only to embedding outputs');
    if (spec.task === 'classification' && spec.outputEncoding !== 'logits')
      fail('Classification training requires logits, not a probability output graph');
    if (spec.task === 'regression' && (spec.outputEncoding !== 'values' || spec.outputSize !== 1))
      fail('Regression currently supports one scalar output');
    if (spec.source.kind === 'mlp') {
      const sizes = [spec.inputSize, ...spec.source.hidden, spec.outputSize];
      const parameters = sizes.slice(1).reduce((sum, size, i) => sum + (sizes[i]! + 1) * size, 0);
      if (parameters > 1_000_000) fail('MLP template is limited to one million parameters');
    }
  });
export type ModelSpec = z.infer<typeof modelSpecSchema>;
