'use server';

import { z } from 'zod';
import { TOUR_IDS, TOUR_STATUSES } from '@/lib/tours';
import { db } from '../db';
import { recordTour } from '../tours';
import { userAction } from './action';

/** Saves where the signed-in person left a tour, so it does not open again on another device. */
export const recordTourAction = userAction(
  z.object({ tour: z.enum(TOUR_IDS), status: z.enum(TOUR_STATUSES) }),
  async (user, input) => {
    await recordTour(db(), user.id, input.tour, input.status);
    return { tour: input.tour, status: input.status };
  },
);
