'use client';

import { ImageUp, Trash2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, Input, NativeSelect } from '@/components/ui/field';
import { BRAND_FONTS, BRAND_FONT_LABELS, isHexColor, type BrandFont } from '@/lib/brand';
import { isWideLogo } from '@/lib/logo-shape';
import { removeLogoAction, updateBrandAction, uploadLogoAction } from '@/server/actions/brand';
import { BrandPreview } from './brand-preview';
import { useAction } from './use-action';

export interface BrandValues {
  logoUrl: string | null;
  logoWide: boolean;
  brandColor: string;
  font: BrandFont;
  senderName: string;
  showBadge: boolean;
}

export function BrandForm({
  workspace,
  brand,
}: {
  workspace: { id: string; name: string };
  brand: BrandValues;
}) {
  const [color, setColor] = useState(brand.brandColor);
  const [font, setFont] = useState<BrandFont>(brand.font);
  const [localLogo, setLocalLogo] = useState<string | null>(null);
  const [localWide, setLocalWide] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const save = useAction();
  const logo = useAction();
  const previewColor = isHexColor(color) ? color : brand.brandColor;

  function submit(event: FormEvent) {
    event.preventDefault();
    save.run(() => updateBrandAction({ workspaceId: workspace.id, brandColor: color, font }), {
      success: 'Brand saved',
    });
  }

  function upload(selected: File | undefined) {
    if (!selected) return;
    const url = URL.createObjectURL(selected);
    setLocalLogo(url);
    setLocalWide(false);
    const probe = new Image();
    probe.onload = () => setLocalWide(isWideLogo(probe.naturalWidth, probe.naturalHeight));
    probe.src = url;
    const form = new FormData();
    form.set('workspaceId', workspace.id);
    form.set('logo', selected);
    logo.run(() => uploadLogoAction(form), { success: 'Logo uploaded' });
    if (file.current) file.current.value = '';
  }

  const local = !logo.errors.logo && localLogo !== null;
  const shownLogo = local ? localLogo : brand.logoUrl;
  const shownWide = local ? localWide : brand.logoWide;

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader
          title="Look"
          description="How your signing pages and emails look to the people you send documents to."
        />
        <CardBody className="grid gap-6 lg:grid-cols-[1fr_minmax(0,320px)]">
          <div className="space-y-5">
            <Field label="Logo" hint="PNG, JPEG or WebP, up to 512 KB." error={logo.errors.logo}>
              {(props) => (
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    {...props}
                    ref={file}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="sr-only"
                    onChange={(e) => upload(e.target.files?.[0])}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    pending={logo.pending}
                    onClick={() => file.current?.click()}
                  >
                    <ImageUp aria-hidden className="h-4 w-4" />{' '}
                    {shownLogo ? 'Replace logo' : 'Upload logo'}
                  </Button>
                  {shownLogo ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setLocalLogo(null);
                        logo.run(() => removeLogoAction({ workspaceId: workspace.id }), {
                          success: 'Logo removed',
                        });
                      }}
                    >
                      <Trash2 aria-hidden className="h-4 w-4" /> Remove
                    </Button>
                  ) : null}
                </div>
              )}
            </Field>
            <Field
              label="Brand colour"
              hint="Used for the header and buttons on the signing page."
              error={save.errors.brandColor}
            >
              {(props) => (
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    aria-label="Pick brand colour"
                    value={previewColor}
                    onChange={(e) => setColor(e.target.value.toUpperCase())}
                    className="h-10 w-12 cursor-pointer rounded-lg border border-line-strong bg-surface p-1"
                  />
                  <Input
                    {...props}
                    value={color}
                    maxLength={7}
                    onChange={(e) => setColor(e.target.value)}
                    className="max-w-[140px] font-mono"
                  />
                </div>
              )}
            </Field>
            <Field label="Font" error={save.errors.font}>
              {(props) => (
                <NativeSelect
                  {...props}
                  value={font}
                  onChange={(e) => setFont(e.target.value as BrandFont)}
                >
                  {BRAND_FONTS.map((value) => (
                    <option key={value} value={value}>
                      {BRAND_FONT_LABELS[value]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">Preview</p>
            <BrandPreview
              logoUrl={shownLogo}
              logoWide={shownWide}
              brandColor={previewColor}
              font={font}
              senderName={brand.senderName}
              workspaceName={workspace.name}
              showBadge={brand.showBadge}
            />
          </div>
        </CardBody>
        <CardFooter>
          <Button type="submit" pending={save.pending}>
            Save brand
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
