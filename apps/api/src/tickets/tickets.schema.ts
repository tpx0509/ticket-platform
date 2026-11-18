
import { z } from 'zod';
export const listTicketsQuerySchema = z.object({
    status: z.enum(['open','pending','resolved','closed']).optional(),
    priority: z.enum(['low','normal','high','urgent']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(10)
})

export const createTicketSchema  = z.object({
    subject: z.string().min(1).max(100),
    description : z.string().min(1).max(500),
    priority: z.enum(['low','normal','high','urgent']).optional()
}).strict()

export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>
export type CreateTicketInput = z.infer<typeof createTicketSchema>