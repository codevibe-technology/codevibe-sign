export { SignaturePad, defaultSignaturePadLabels } from './signature/SignaturePad';
export type { SignaturePadProps, SignaturePadLabels } from './signature/SignaturePad';
export { useSignaturePad } from './signature/useSignaturePad';
export type {
  SignatureMode,
  SignaturePadState,
  UseSignaturePadOptions,
} from './signature/useSignaturePad';
export { defaultPenColors, defaultSignatureFonts } from './signature/render';
export type { PenColor, SignatureFont } from './signature/render';
export { encodeSignature, imageFileToSignature, ACCEPTED_IMAGE_TYPES } from './signature/image';
export type { EncodeOptions, UploadOptions } from './signature/image';

export { SigningView, defaultSigningViewLabels } from './signing/SigningView';
export type { SigningViewProps, SigningViewLabels } from './signing/SigningView';
export {
  fieldStatus,
  isoDate,
  prefillValues,
  sortFields,
  toFieldValues,
  validateFieldValues,
} from './signing/values';
export type { FieldStatus, FieldValues, ValidationResult } from './signing/values';

export { FieldPlacer, defaultFieldPlacerLabels } from './placer/FieldPlacer';
export type { FieldPlacerProps, FieldPlacerLabels } from './placer/FieldPlacer';
export { useFieldPlacement } from './placer/useFieldPlacement';
export type { FieldPlacementState, UseFieldPlacementOptions } from './placer/useFieldPlacement';
export { createField, defaultFieldSizes, freeRect, nudgeRect } from './placer/placement';
export {
  aadhaarBoxOnLastPage,
  choiceForPages,
  fieldGroups,
  formatPageList,
  initialsOnEveryPage,
  pagesForChoice,
  parsePageRange,
  repeatField,
  scaleRectBetween,
  signatureOnLastPage,
} from './placer/multipage';
export type { PageList, PresetInput, RepeatChoice } from './placer/multipage';
export { fieldsFromTags, findTags } from './placer/tags';
export type { FieldTag, TagFieldsInput } from './placer/tags';
export { coveredText, fieldsOverText } from './placer/overlap';
export type { ArrowKey, Size } from './placer/placement';

export {
  clampRect,
  clientToPoints,
  flipVertical,
  pixelsToPoints,
  pointsToPixels,
  scaleForWidth,
  snapToPageEdges,
} from './geometry';
export type { PixelRect } from './geometry';

export { loadPdf } from './pdf/pdfjs';
export type { LoadPdfOptions, PdfjsModule } from './pdf/pdfjs';
export { usePdfSources } from './pdf/usePdfSources';
export type {
  PdfFile,
  PdfSource,
  RenderPage,
  RenderedPage,
  TextItem,
  ViewerDocument,
} from './pdf/types';
export { defaultViewerLabels } from './viewer/DocumentPages';
export type { ViewerLabels } from './viewer/DocumentPages';
export { defaultFieldTypeLabels, recipientColorIndex } from './labels';
