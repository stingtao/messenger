import React, { useEffect, useRef } from 'react';

const ADSENSE_CLIENT_ID = 'ca-pub-6452867962392355';
const MESSENGER_AD_SLOT = '1597637799';
const ADSENSE_SCRIPT_ID = 'google-adsense-script';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

export default function GoogleAd() {
  const pushedRef = useRef(false);

  useEffect(() => {
    if (!document.getElementById(ADSENSE_SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = ADSENSE_SCRIPT_ID;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`;
      document.head.appendChild(script);
    }

    if (!pushedRef.current) {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
      pushedRef.current = true;
    }
  }, []);

  return (
    <div className="mt-6 w-full min-h-[90px]" aria-label="Advertisement">
      <ins
        className="adsbygoogle block w-full"
        data-ad-client={ADSENSE_CLIENT_ID}
        data-ad-slot={MESSENGER_AD_SLOT}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
