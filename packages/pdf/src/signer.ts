import forge from 'node-forge';
import { SignError } from '@codevibe_technology/sign-core';
import { certificateDer, readP12 } from './cms';

/**
 * Where the seal key lives. `seal()` builds the CMS structure itself and asks the provider
 * only for the certificate chain and for one RSA signature, so the key can stay in a file, a
 * hardware token or a remote signing service.
 */
export interface SealProvider {
  /** Short name used in error messages, such as `p12`. */
  readonly kind: string;
  /** The seal certificate first, then the certificates that issued it, as DER. */
  certificateChain(): Promise<Uint8Array[]>;
  /**
   * Signs `data` with SHA-256 and the seal key (RSASSA-PKCS1-v1_5) and returns the raw
   * signature value.
   */
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export interface P12SignerOptions {
  /** PKCS#12 (.p12 / .pfx) file with the RSA key, its certificate and any issuers. */
  p12: Uint8Array;
  passphrase?: string;
}

const fromBinary = (binary: string) => new Uint8Array(Buffer.from(binary, 'binary'));

/** The default provider: the key and certificates come from a PKCS#12 file. */
export function p12Signer(options: P12SignerOptions): SealProvider {
  const identity = readP12(options.p12, options.passphrase ?? '');
  return {
    kind: 'p12',
    async certificateChain() {
      return identity.chain.map((certificate) => fromBinary(certificateDer(certificate)));
    },
    async sign(data) {
      const md = forge.md.sha256.create();
      md.update(Buffer.from(data).toString('binary'));
      return fromBinary(identity.key.sign(md));
    },
  };
}

function notConfigured(kind: string, what: string): SignError {
  return new SignError(
    'SEAL_FAILED',
    `The ${what} seal signer is not configured in this build. Use the p12 signer, or pass your own SealProvider.`,
    { option: 'signer', provider: kind },
  );
}

export interface Pkcs11SignerOptions {
  /** Path to the PKCS#11 module of the HSM or token, for example a vendor `.so` file. */
  module: string;
  /** Token label of the slot that holds the seal key. */
  tokenLabel?: string;
  /** Label (CKA_LABEL) of the private key and its certificate. */
  keyLabel?: string;
  /** User PIN for the token. */
  pin?: string;
}

/**
 * Signs with a key on a hardware security module or token over PKCS#11 (CKM_SHA256_RSA_PKCS).
 * Not available in this build, because it needs a native binding; every call fails with
 * `SEAL_FAILED`. Implement `SealProvider` against your HSM's library to use one today.
 */
export function pkcs11Signer(options: Pkcs11SignerOptions): SealProvider {
  void options;
  return {
    kind: 'pkcs11',
    certificateChain: () => Promise.reject(notConfigured('pkcs11', 'PKCS#11')),
    sign: () => Promise.reject(notConfigured('pkcs11', 'PKCS#11')),
  };
}

export interface CscSignerOptions {
  /** Base URL of the Cloud Signature Consortium API, for example `https://cs.example.com/csc/v1`. */
  serviceUrl: string;
  /** The credential (key and certificate) to sign with. */
  credentialId: string;
  /** OAuth access token for the service, or a function that returns a fresh one. */
  accessToken: string | (() => Promise<string>);
}

/**
 * Signs through a remote signing service that speaks the Cloud Signature Consortium API
 * (credentials/info, credentials/authorize, signatures/signHash), as CA document signing
 * certificates kept in the CA's HSM require. Not available in this build: each service has its
 * own authorisation step, so every call fails with `SEAL_FAILED`.
 */
export function cscSigner(options: CscSignerOptions): SealProvider {
  void options;
  return {
    kind: 'csc',
    certificateChain: () => Promise.reject(notConfigured('csc', 'Cloud Signature Consortium')),
    sign: () => Promise.reject(notConfigured('csc', 'Cloud Signature Consortium')),
  };
}
