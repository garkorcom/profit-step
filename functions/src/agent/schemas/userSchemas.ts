import { z } from 'zod';

export const UserSearchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export const ListUsersQuerySchema = z.object({
  role: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const CreateUserFromBotSchema = z.object({
  telegramId: z.number().int().positive(),
  displayName: z.string().min(1),
  hourlyRate: z.number().min(0),
  role: z.string().default('worker'),
});

export const ContactPhoneSchema = z.object({
  number: z.string().min(1),
  label: z.string().default('Мобильный'),
});

export const CreateContactSchema = z.object({
  name: z.string().min(1),
  phones: z.array(ContactPhoneSchema).default([]),
  roles: z.array(z.string()).default([]),
  linkedProjects: z.array(z.string()).default([]),
  notes: z.string().optional(),
  location: z.string().optional(),
  emails: z.array(z.string().email()).default([]),
  messengers: z.object({
    whatsapp: z.string().optional(),
    telegram: z.string().optional(),
  }).default({}),
  defaultCity: z.string().optional(),
});

export const SearchContactsQuerySchema = z.object({
  q: z.string().min(1),
  role: z.string().optional(),
  projectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
