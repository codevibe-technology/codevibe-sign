'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  MAX_BULK_CSV_BYTES,
  bulkSendView,
  fixedPeopleProblems,
  previewBulkCsv,
} from '@/lib/bulk-send';
import { sendProblems } from '@/lib/templates';
import { cancelBulkSend, createBulkSend, getBulkSend, listBulkRows } from '../bulk-sends';
import { processBulkSend } from '../bulk-worker';
import { db } from '../db';
import { recordSender } from '../envelopes';
import { AppError } from '../errors';
import { inspectUpload } from '../pdf';
import { appRuntime } from '../runtime';
import { signRequest } from '../sign/client';
import { roleField, sendFromTemplate } from '../template-send';
import {
  createTemplate,
  definitionInputSchema,
  duplicateTemplate,
  requireTemplate,
  setTemplateArchived,
  stageDocument,
  updateTemplate,
} from '../templates';
import { workspaceAction } from './action';

const id = z.string().min(1).max(100);
const person = z.object({
  name: z.string().max(400),
  email: z.string().max(400),
  phone: z.string().max(40),
});
const people = z.record(z.string().max(100), person);
const refresh = (slug: string) => revalidatePath(`/w/${slug}/templates`, 'layout');

/** Checks a PDF and keeps it until the template is saved. */
export const stageTemplateDocumentAction = workspaceAction(
  'envelopes.write',
  z.object({ file: z.instanceof(File, { error: 'Choose a PDF file' }) }),
  async (ctx, input) => {
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const info = await inspectUpload(input.file.name, bytes);
    const stagedKey = await stageDocument(appRuntime().files, ctx.workspace.id, bytes);
    return { pages: info.pages, stagedKey };
  },
);

export const createTemplateAction = workspaceAction(
  'envelopes.write',
  z.object({
    definition: definitionInputSchema,
    documents: z
      .array(
        z.object({
          id,
          name: z.string().min(1).max(300),
          stagedKey: z.string().min(1).max(300),
          pages: z.array(z.object({ width: z.number(), height: z.number() })).max(10_000),
        }),
      )
      .max(50),
  }),
  async (ctx, input) => {
    const template = await createTemplate(db(), appRuntime().files, {
      workspaceId: ctx.workspace.id,
      createdBy: ctx.user.id,
      definition: input.definition,
      documents: input.documents,
      inspect: inspectUpload,
    });
    refresh(ctx.workspace.slug);
    return { id: template.id };
  },
);

export const updateTemplateAction = workspaceAction(
  'envelopes.write',
  z.object({ templateId: id, definition: definitionInputSchema }),
  async (ctx, input) => {
    await updateTemplate(db(), ctx.workspace.id, input.templateId, input.definition);
    refresh(ctx.workspace.slug);
    return { id: input.templateId };
  },
);

export const duplicateTemplateAction = workspaceAction(
  'envelopes.write',
  z.object({ templateId: id }),
  async (ctx, input) => {
    const copy = await duplicateTemplate(db(), appRuntime().files, {
      workspaceId: ctx.workspace.id,
      id: input.templateId,
      createdBy: ctx.user.id,
    });
    refresh(ctx.workspace.slug);
    return { id: copy.id, name: copy.name };
  },
);

export const archiveTemplateAction = workspaceAction(
  'envelopes.write',
  z.object({ templateId: id, archived: z.boolean() }),
  async (ctx, input) => {
    await setTemplateArchived(db(), ctx.workspace.id, input.templateId, input.archived);
    refresh(ctx.workspace.slug);
  },
);

/** Creates one envelope from the template and sends it at once. */
export const sendTemplateAction = workspaceAction(
  'envelopes.write',
  z.object({
    templateId: id,
    people,
    title: z.string().max(400),
    message: z.string().max(10_000),
  }),
  async (ctx, input) => {
    const sql = db();
    const template = await requireTemplate(sql, ctx.workspace.id, input.templateId);
    if (template.archivedAt)
      throw new AppError('CONFLICT', 'Restore the template before sending it.');
    const problem = Object.entries(
      sendProblems(template.definition, input.people, {
        title: input.title,
        message: input.message,
      }),
    )[0];
    if (problem) throw new AppError('VALIDATION', problem[1], problem[0]);
    try {
      const envelope = await sendFromTemplate(
        {
          files: appRuntime().files,
          request: signRequest,
          recordSender: (r) => recordSender(sql, r),
        },
        {
          template,
          userId: ctx.user.id,
          people: input.people,
          title: input.title,
          message: input.message,
        },
      );
      revalidatePath(`/w/${ctx.workspace.slug}`, 'layout');
      return { envelopeId: envelope.id };
    } catch (err) {
      if (err instanceof AppError)
        throw new AppError(err.code, err.message, roleField(err.field, template));
      if (err instanceof Error && err.name === 'RateLimitedError') {
        throw new AppError(
          'CONFLICT',
          'Too many envelopes were sent in the last minute. Wait a moment and send again.',
        );
      }
      throw err;
    }
  },
);

/**
 * Starts a bulk send from a CSV. The file is read again here, so only rows this server
 * accepts are sent, and sending carries on in the background.
 */
export const startBulkSendAction = workspaceAction(
  'envelopes.write',
  z.object({
    templateId: id,
    csv: z
      .string()
      .max(MAX_BULK_CSV_BYTES, 'The file is larger than 1 MB. Split it into smaller files.'),
    fixed: people,
    skipProblems: z.boolean(),
  }),
  async (ctx, input) => {
    const sql = db();
    const template = await requireTemplate(sql, ctx.workspace.id, input.templateId);
    if (template.archivedAt)
      throw new AppError('CONFLICT', 'Restore the template before sending it.');
    const preview = previewBulkCsv(input.csv, template, template.definition, input.fixed);
    if (preview.blocking) {
      throw new AppError(
        'VALIDATION',
        preview.problems[0]?.message ?? 'The file cannot be used.',
        'csv',
      );
    }
    const fixedProblem = Object.entries(fixedPeopleProblems(preview.fixedRoles, input.fixed))[0];
    if (fixedProblem) throw new AppError('VALIDATION', fixedProblem[1], fixedProblem[0]);
    const bad = new Set(preview.problems.map((p) => p.line)).size;
    if (bad > 0 && !input.skipProblems) {
      throw new AppError(
        'VALIDATION',
        `${bad} ${bad === 1 ? 'row has' : 'rows have'} problems. Fix them, or choose to skip them.`,
        'csv',
      );
    }
    const bulkId = await createBulkSend(sql, {
      workspaceId: ctx.workspace.id,
      templateId: template.id,
      templateName: template.name,
      createdBy: ctx.user.id,
      rows: preview.ready,
    });
    void processBulkSend({
      id: bulkId,
      workspaceId: ctx.workspace.id,
      templateId: template.id,
      createdBy: ctx.user.id,
    }).catch((err: unknown) =>
      console.error('[bulk] failed', err instanceof Error ? err.message : err),
    );
    refresh(ctx.workspace.slug);
    return { bulkId, count: preview.ready.length };
  },
);

/** The progress of a bulk send and its rows, for the page that follows it. */
export const bulkSendStatusAction = workspaceAction(
  'envelopes.read',
  z.object({ bulkId: id }),
  async (ctx, input) => {
    const sql = db();
    const bulk = await getBulkSend(sql, ctx.workspace.id, input.bulkId);
    if (!bulk) throw new AppError('NOT_FOUND', 'That bulk send no longer exists.');
    const rows = await listBulkRows(sql, bulk.id);
    return { bulk: bulkSendView(bulk), rows };
  },
);

export const cancelBulkSendAction = workspaceAction(
  'envelopes.write',
  z.object({ bulkId: id }),
  async (ctx, input) => {
    await cancelBulkSend(db(), ctx.workspace.id, input.bulkId);
    refresh(ctx.workspace.slug);
  },
);
