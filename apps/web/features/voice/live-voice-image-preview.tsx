'use client';

import { useState, type CSSProperties } from 'react';

export function LiveVoiceImagePreview({
  src,
  alt,
}: {
  readonly src: string;
  readonly alt: string;
}) {
  const [aspectRatio, setAspectRatio] = useState(4 / 3);

  return (
    <div
      className="live-voice-image-preview"
      style={{ '--live-image-ratio': aspectRatio } as CSSProperties}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onLoad={(event) => {
          const image = event.currentTarget;
          if (image.naturalWidth && image.naturalHeight) {
            setAspectRatio(image.naturalWidth / image.naturalHeight);
          }
        }}
      />
    </div>
  );
}
