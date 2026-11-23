import 'server-only';
import type postgres from 'postgres';
import { isTourId, TOUR_STATUSES, type TourId, type TourStatus } from '@/lib/tours';
import { AppError } from './errors';

/** The tours this person has opened, finished or closed. A tour missing here opens on its own. */
export async function getTours(
  sql: postgres.Sql,
  userId: string,
): Promise<Partial<Record<TourId, TourStatus>>> {
  const rows = await sql<{ tour: string; status: TourStatus }[]>`
    select tour, status from app_user_tours where user_id = ${userId}`;
  const out: Partial<Record<TourId, TourStatus>> = {};
  for (const row of rows) if (isTourId(row.tour)) out[row.tour] = row.status;
  return out;
}

/** Records how far this person got. The latest run wins, so a replay can end as done. */
export async function recordTour(
  sql: postgres.Sql,
  userId: string,
  tour: string,
  status: string,
): Promise<void> {
  if (!isTourId(tour)) throw new AppError('VALIDATION', 'There is no such tour', 'tour');
  if (!(TOUR_STATUSES as readonly string[]).includes(status)) {
    throw new AppError('VALIDATION', 'Say whether the tour was started, done or skipped', 'status');
  }
  await sql`
    insert into app_user_tours (user_id, tour, status)
    values (${userId}, ${tour}, ${status})
    on conflict (user_id, tour) do update set status = excluded.status, updated_at = now()`;
}
