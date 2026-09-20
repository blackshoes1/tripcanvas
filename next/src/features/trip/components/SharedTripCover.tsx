'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

import { cloudApi } from '@/features/cloud/services/tripCanvasClient';

/** iOS에서 저장한 표지를 같은 여행 권한으로 조회한다. 사진을 여행 문서에 넣지 않는다. */
export function SharedTripCover({ tripId, name, signedIn }: { tripId: string; name: string; signedIn: boolean }) {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      const { data, error } = await cloudApi.covers.get(tripId);
      if (!active || request !== sequence) return;
      const encoded = data?.imageBase64;
      setImage(!error && typeof encoded === 'string' && encoded.length <= 333336 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
        ? `data:image/jpeg;base64,${encoded}` : null);
    };
    void load();
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, [tripId, signedIn]);
  if (!signedIn || !image) return null;
  return <Image src={image} alt={`${name} 표지`} width={64} height={48} unoptimized style={{ objectFit: 'cover', borderRadius: 4 }} />;
}
