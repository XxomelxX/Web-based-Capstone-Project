import { z } from 'zod';

// MONEY: all monetary values in queued payloads are INTEGER CENTAVOS
// (₱25.50 === 2550). See lib/money.ts. Zod rejects legacy float payloads
// so stale offline queues fail loudly instead of corrupting balances.

export const saleItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(1000),
  unitPrice: z.number().int().nonnegative(), // centavos
});

export const queuedActionSchema = z.object({
  clientUuid: z.string().uuid(),
  type: z.enum(['pos_sale', 'add_utang', 'record_payment', 'open_shift', 'close_shift',
    'cash_movement',
    'product_upsert', 'product_delete', 'category_upsert', 'category_delete',
    'expense_add', 'settings_update', 'customer_add', 'void_sale', 'void_request',
    'void_request_cancel', 'void_review', 'utang_update_deadline', 'restock']),
  payload: z.object({
    items: z.array(saleItemSchema).optional(),
    paymentMethod: z.string().optional(),
    tendered: z.number().int().nonnegative().optional(), // centavos
    gcashRef: z.string().max(50).optional(),
    customerId: z.number().int().positive().nullable().optional(),
    customerName: z.string().max(200).optional(),
    note: z.string().max(500).optional(),
    dueDate: z.string().max(40).optional(),
    utangEntryId: z.number().int().positive().optional(),
    notes: z.string().max(500).optional(),
    amount: z.number().int().positive().optional(), // centavos
    expectedBalance: z.number().int().optional(), // centavos
    expectedSubtotal: z.number().int().optional(), // centavos
    openingFloat: z.number().int().nonnegative().optional(), // centavos
    closingCash: z.number().int().nonnegative().optional(), // centavos
    openedAt: z.string().optional(),
    closedAt: z.string().optional(),
    movementType: z.enum(['cash_in', 'cash_out', 'expense']).optional(),
    // Category-2 entity mutations (server-wins, last-write-wins on fields)
    entityId: z.number().int().positive().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    transactionId: z.number().int().positive().optional(),
    productId: z.number().int().positive().optional(),
    quantity: z.number().int().positive().optional(),
    supplier: z.string().max(200).nullish(),
    costPerUnit: z.number().int().nonnegative().nullish(), // centavos
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
