import { z } from 'zod';

export const saleItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(1000),
  unitPrice: z.number().nonnegative().finite(),
});

export const queuedActionSchema = z.object({
  clientUuid: z.string().uuid(),
  type: z.enum(['pos_sale', 'add_utang', 'record_payment', 'open_shift', 'close_shift']),
  payload: z.object({
    items: z.array(saleItemSchema).optional(),
    paymentMethod: z.string().optional(),
    tendered: z.number().optional(),
    customerId: z.number().int().positive().nullable().optional(),
    customerName: z.string().max(200).optional(),
    note: z.string().max(500).optional(),
    notes: z.string().max(500).optional(),
    amount: z.number().positive().optional(),
    expectedBalance: z.number().optional(),
    openingFloat: z.number().nonnegative().optional(),
    closingCash: z.number().nonnegative().optional(),
    openedAt: z.string().optional(),
    closedAt: z.string().optional(),
  }),
  createdAt: z.string(),
});

export const batchSyncSchema = z.object({
  actions: z.array(queuedActionSchema).max(100),
});

export type QueuedActionInput = z.infer<typeof queuedActionSchema>;
