import { z } from 'zod';

export const saleItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(1000),
  unitPrice: z.number().nonnegative().finite(),
});

export const queuedActionSchema = z.object({
  clientUuid: z.string().uuid(),
  type: z.enum(['pos_sale', 'add_utang', 'record_payment', 'open_shift', 'close_shift',
    'product_upsert', 'product_delete', 'category_upsert', 'category_delete',
    'expense_add', 'settings_update', 'customer_add', 'void_sale', 'void_request',
    'void_request_cancel', 'void_review', 'restock']),
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
    expectedSubtotal: z.number().optional(),
    openingFloat: z.number().nonnegative().optional(),
    closingCash: z.number().nonnegative().optional(),
    openedAt: z.string().optional(),
    closedAt: z.string().optional(),
    // Category-2 entity mutations (server-wins, last-write-wins on fields)
    entityId: z.number().int().positive().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    transactionId: z.number().int().positive().optional(),
    productId: z.number().int().positive().optional(),
    quantity: z.number().int().positive().optional(),
    supplier: z.string().max(200).nullish(),
    costPerUnit: z.number().nonnegative().nullish(),
    reason: z.string().max(500).optional(),
    supervisorUsername: z.string().max(100).optional(),
    supervisorVerifiedAt: z.string().optional(),
    cashierUsername: z.string().max(100).optional(),
    requestedBy: z.number().int().positive().optional(),
    voidRequestId: z.number().int().positive().optional(),
    approved: z.boolean().optional(),
    reviewNote: z.string().max(500).optional(),
    tempId: z.number().int().optional(),
    table: z.enum(['products', 'categories', 'expenses', 'customers']).optional(),
  }),
  createdAt: z.string(),
});

export const batchSyncSchema = z.object({
  actions: z.array(queuedActionSchema).max(100),
});

export type QueuedActionInput = z.infer<typeof queuedActionSchema>;
