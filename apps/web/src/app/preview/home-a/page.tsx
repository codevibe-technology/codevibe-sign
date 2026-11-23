import { HomePreview, previewMetadata } from '../home-preview';

export const metadata = previewMetadata('a');

export default function HomeOptionA() {
  return <HomePreview option="a" />;
}
