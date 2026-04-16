import { z } from 'zod';

export const CreateTeamSchema = z.object({
  name: z.string().min(1).max(100),
  leadUid: z.string().min(1),
  memberUids: z.array(z.string()).default([]),
});

export const UpdateTeamSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  leadUid: z.string().min(1).optional(),
});

export const TeamMemberSchema = z.object({
  uid: z.string().min(1),
});
