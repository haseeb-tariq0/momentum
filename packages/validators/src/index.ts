import { z } from 'zod'

export const uuidSchema = z.string().uuid()
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
export const emailSchema = z.string().email()
export const positiveHours = z.number().positive().max(24)

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit:  z.coerce.number().min(1).max(100).default(50),
})

export const dateRangeSchema = z.object({
  startDate: dateSchema.optional(),
  endDate:   dateSchema.optional(),
})

// Re-export zod for convenience
export { z }
