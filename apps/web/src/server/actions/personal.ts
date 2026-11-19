'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { THEME_COOKIE } from '@/lib/preferences';
import { db } from '../db';
import { updatePreferences } from '../preferences';
import { userAction } from './action';

export const updatePreferencesAction = userAction(
  z.object({ theme: z.string().optional(), timezone: z.string().optional() }),
  async (user, input) => {
    const saved = await updatePreferences(db(), user.id, {
      ...(input.theme !== undefined ? { theme: input.theme } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    });
    (await cookies()).set(THEME_COOKIE, saved.theme, {
      path: '/',
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60,
    });
    return saved;
  },
);
