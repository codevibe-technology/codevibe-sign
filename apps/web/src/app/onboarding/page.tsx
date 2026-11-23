import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { UpgradePrompt } from '@/components/billing/upgrade-prompt';
import { AuthFrame, StatusPage } from '@/components/shell/status-page';
import { hasName } from '@/lib/person-name';
import { requireUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { countWorkspaces, listWorkspacesForUser, newWorkspaceBlock } from '@/server/workspaces';
import { CreateWorkspaceForm } from './create-workspace-form';

export const metadata: Metadata = { title: 'Create a workspace' };

export default async function OnboardingPage() {
  const user = await requireUser('/onboarding');
  const sql = db();
  if (env().SINGLE_WORKSPACE && (await countWorkspaces(sql)) > 0) {
    return (
      <StatusPage
        icon={Lock}
        title="Ask for an invitation"
        description="This installation has one workspace, and people join it by invitation. Ask its admin to invite your email address."
      />
    );
  }
  const existing = await listWorkspacesForUser(sql, user.id);
  const block = await newWorkspaceBlock(sql, user.id);
  if (block) {
    return (
      <AuthFrame>
        <p className="eyebrow">New workspace</p>
        <h1 className="mt-2 text-[26px] leading-tight font-bold">
          Your plan includes one workspace
        </h1>
        <p className="mt-1.5 mb-5 text-muted">
          On Cloud you can create as many workspaces as you need under one subscription, with
          members, templates and usage shared across them.
        </p>
        <UpgradePrompt
          message={block.error.message}
          limit={block.error.details()}
          slug={block.slug ?? undefined}
        />
        {block.slug ? (
          <p className="mt-5 text-sm">
            <Link
              className="font-semibold text-primary underline"
              href={`/dashboard/${block.slug}`}
            >
              Back to your workspace
            </Link>
          </p>
        ) : null}
      </AuthFrame>
    );
  }
  return (
    <AuthFrame>
      <p className="eyebrow">
        {existing.length
          ? 'New workspace'
          : `Welcome${user.name ? `, ${user.name.split(' ')[0]}` : ''}`}
      </p>
      <h1 className="mt-2 text-[26px] leading-tight font-bold">Create your workspace</h1>
      <p className="mt-1.5 mb-6 text-muted">
        A workspace holds your documents, templates, team and brand. Use your company or team name.
        You can change the name and the address later.
      </p>
      <CreateWorkspaceForm host={new URL(env().APP_URL).host} askName={!hasName(user)} />
    </AuthFrame>
  );
}
