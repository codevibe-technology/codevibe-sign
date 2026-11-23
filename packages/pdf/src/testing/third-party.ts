import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignPdf } from '@signpdf/signpdf';
import { Signer } from '@signpdf/utils';
import forge from 'node-forge';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { buildCadesSignature } from '../cms';
import { addSignaturePlaceholder } from '../placeholder';
import { p12Signer } from '../signer';
import type { TestP12 } from './p12';

/** A key and certificate made by OpenSSL, of a kind node-forge cannot issue. */
export interface OpensslIdentity {
  kind: 'ec' | 'rsa-pss';
  directory: string;
  /** Removes the key files. */
  dispose(): void;
}

export function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** A self-signed signer certificate with an ECDSA P-256 key, or an RSA key used with PSS. */
export function createOpensslIdentity(kind: OpensslIdentity['kind'], commonName: string) {
  const directory = mkdtempSync(join(tmpdir(), 'sign-pdf-esp-'));
  const key =
    kind === 'ec'
      ? ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1']
      : ['-newkey', 'rsa:2048'];
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      ...key,
      '-nodes',
      '-keyout',
      join(directory, 'key.pem'),
      '-out',
      join(directory, 'cert.pem'),
      '-subj',
      `/CN=${commonName}/O=Test eSign Provider/C=IN`,
      '-days',
      '2',
    ],
    { stdio: 'ignore' },
  );
  const identity: OpensslIdentity = {
    kind,
    directory,
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  };
  return identity;
}

/** A detached CMS signature with signed attributes, made by `openssl cms`. */
function opensslCms(content: Buffer, identity: OpensslIdentity): Buffer {
  const input = join(identity.directory, 'content.bin');
  const output = join(identity.directory, 'signature.der');
  writeFileSync(input, content);
  execFileSync(
    'openssl',
    [
      'cms',
      '-sign',
      '-binary',
      '-md',
      'sha256',
      '-in',
      input,
      '-signer',
      join(identity.directory, 'cert.pem'),
      '-inkey',
      join(identity.directory, 'key.pem'),
      ...(identity.kind === 'rsa-pss' ? ['-keyopt', 'rsa_padding_mode:pss'] : []),
      '-outform',
      'DER',
      '-out',
      output,
    ],
    { stdio: 'ignore' },
  );
  return readFileSync(output);
}

export interface ThirdPartyOptions {
  /** Who signs: a PKCS#12 identity (RSA, CAdES) or an OpenSSL one (`adbe.pkcs7.detached`). */
  identity: TestP12 | OpensslIdentity;
  /** Save with a cross-reference stream and object streams instead of a classic table. */
  objectStreams?: boolean;
  /** Keep the form dictionary inline in the catalog. */
  directForm?: boolean;
  /** Keep the form's /Fields array as an object of its own. */
  indirectFields?: boolean;
  /** Keep the first page's /Annots array as an object of its own. */
  indirectAnnots?: boolean;
  /** Certify the file with this DocMDP level instead of an approval signature. */
  docMdp?: 1 | 2 | 3;
  /** Give the signature field a /Lock dictionary with this action. */
  lock?: 'All' | 'Include' | 'Exclude';
}

class CallbackSigner extends Signer {
  constructor(private readonly build: (content: Buffer) => Promise<Buffer>) {
    super();
  }

  override async sign(content: Buffer): Promise<Buffer> {
    return this.build(content);
  }
}

/**
 * Signs an unsigned PDF the way another product would, for tests: the first signature of the
 * file, in the layout the options ask for. The file is written whole, so the input must not
 * be signed already.
 */
export async function signAsThirdParty(
  bytes: Uint8Array,
  options: ThirdPartyOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  addSignaturePlaceholder(doc, {
    kind: options.docMdp ? 'certification' : 'approval',
    reason: 'Signed by the signer',
    location: '',
    contactInfo: '',
    name: 'Signer',
    signingTime: new Date(),
    signatureLength: 8192,
  });
  const { context } = doc;
  const formRef = doc.catalog.get(PDFName.of('AcroForm'));
  const form = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
  const fields = form.lookup(PDFName.of('Fields'), PDFArray);
  if (options.lock) {
    const widget = context.lookup(fields.get(fields.size() - 1), PDFDict);
    widget.set(
      PDFName.of('Lock'),
      context.obj({ Type: 'SigFieldLock', Action: options.lock, Fields: ['Other'] }),
    );
  }
  if (options.indirectFields) {
    form.set(PDFName.of('Fields'), context.register(fields));
  }
  if (options.directForm && formRef instanceof PDFRef) {
    doc.catalog.set(PDFName.of('AcroForm'), form);
    context.delete(formRef);
  }
  if (options.indirectAnnots) {
    const page = doc.getPages()[0]!;
    const annots = page.node.lookup(PDFName.of('Annots'), PDFArray);
    page.node.set(PDFName.of('Annots'), context.register(annots));
  }

  let prepared = Buffer.from(await doc.save({ useObjectStreams: options.objectStreams ?? false }));
  const swap = (from: string, to: string) => {
    const at = prepared.indexOf(from, 0, 'latin1');
    if (at < 0 || from.length !== to.length) {
      throw new Error(`Cannot rewrite ${from} in the test file`);
    }
    prepared = Buffer.concat([
      prepared.subarray(0, at),
      Buffer.from(to, 'latin1'),
      prepared.subarray(at + from.length),
    ]);
  };
  if (options.docMdp && options.docMdp !== 1) {
    swap('/P 1\n/V', `/P ${options.docMdp}\n/V`);
  }

  const { identity } = options;
  let signer: CallbackSigner;
  if ('p12' in identity) {
    const provider = p12Signer({ p12: identity.p12, passphrase: identity.passphrase });
    const chainDer = (await provider.certificateChain()).map((der) =>
      Buffer.from(der).toString('binary'),
    );
    const chain = chainDer.map((der) => forge.pki.certificateFromAsn1(forge.asn1.fromDer(der)));
    signer = new CallbackSigner((content) =>
      buildCadesSignature(content, { chain, chainDer, sign: (data) => provider.sign(data) }),
    );
  } else {
    swap('/SubFilter /ETSI.CAdES.detached', '/SubFilter /adbe.pkcs7.detached');
    signer = new CallbackSigner(async (content) => opensslCms(content, identity));
  }
  return new Uint8Array(await new SignPdf().sign(prepared, signer));
}
