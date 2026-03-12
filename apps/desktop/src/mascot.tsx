import { useEffect, useState } from "react";
import type { SearchResult } from "@nyaagrab/contracts";

export type MascotState =
  | "idle"
  | "searching"
  | "success"
  | "perfect"
  | "missing"
  | "exporting"
  | "copying"
  | "error"
  | "easterEgg";

export type MascotVideoAsset = {
  src: string;
  mimeType?: string;
  poster?: string;
};

export type MascotAsset = {
  still: string;
  fallback: string;
  poster?: string;
  video?: MascotVideoAsset;
};

export const mascotManifest: Record<MascotState, MascotAsset> = {
  idle: {
    still: "/mascot/stills/idle.jpg",
    poster: "/mascot/posters/idle.jpg",
    fallback: "/mascot/stills/header.jpg"
  },
  searching: {
    still: "/mascot/stills/searching.jpg",
    poster: "/mascot/posters/searching.jpg",
    fallback: "/mascot/stills/header.jpg"
  },
  success: {
    still: "/mascot/stills/success.jpg",
    poster: "/mascot/posters/success.jpg",
    fallback: "/mascot/stills/header.jpg"
  },
  perfect: {
    still: "/mascot/stills/perfect.jpg",
    poster: "/mascot/posters/perfect.jpg",
    fallback: "/mascot/stills/header.jpg"
  },
  missing: {
    still: "/mascot/stills/missing.jpg",
    poster: "/mascot/posters/missing.jpg",
    fallback: "/mascot/stills/header.jpg"
  },
  exporting: {
    still: "/mascot/stills/success.jpg",
    poster: "/mascot/posters/success.jpg",
    fallback: "/mascot/stills/header.jpg"
  },
  copying: {
    still: "/mascot/stills/success.jpg",
    poster: "/mascot/posters/success.jpg",
    fallback: "/mascot/stills/header.jpg"
  },
  error: {
    still: "/mascot/stills/missing.jpg",
    poster: "/mascot/posters/missing.jpg",
    fallback: "/mascot/stills/header.jpg"
  },
  easterEgg: {
    still: "/mascot/stills/perfect.jpg",
    poster: "/mascot/posters/perfect.jpg",
    fallback: "/mascot/stills/header.jpg"
  }
};

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPrefersReducedMotion(mediaQuery.matches);

    sync();
    mediaQuery.addEventListener?.("change", sync);

    return () => mediaQuery.removeEventListener?.("change", sync);
  }, []);

  return prefersReducedMotion;
}

export function getBaseMascotState(busy: boolean, result: SearchResult | null): MascotState {
  if (busy) return "searching";
  if (!result) return "idle";
  if (result.coveragePercent >= 100) return "perfect";
  if (result.coveragePercent > 0) return "success";
  return "missing";
}

export function MascotDisplay({
  state,
  asset,
  onActivate
}: {
  state: MascotState;
  asset?: MascotAsset;
  onActivate?: () => void;
}) {
  const resolvedAsset = asset ?? mascotManifest[state];
  const prefersReducedMotion = usePrefersReducedMotion();
  const [useVideo, setUseVideo] = useState(Boolean(resolvedAsset.video && !prefersReducedMotion));
  const [imageSrc, setImageSrc] = useState(resolvedAsset.still);

  useEffect(() => {
    setImageSrc(resolvedAsset.still);
    setUseVideo(Boolean(resolvedAsset.video && !prefersReducedMotion));
  }, [prefersReducedMotion, resolvedAsset]);

  const className = `mascot-container${state === "searching" ? " searching" : ""}`;

  const activate = () => {
    onActivate?.();
  };

  return (
    <div
      className={className}
      data-state={state}
      data-testid="mascot-container"
      role="button"
      tabIndex={0}
      aria-label={`NyaaGrab mascot — ${state}`}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
    >
      {useVideo && resolvedAsset.video ? (
        <video
          key={`${state}-video`}
          className="mascot-media"
          data-testid="mascot-video"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster={resolvedAsset.video.poster ?? resolvedAsset.poster ?? resolvedAsset.still}
          onError={() => setUseVideo(false)}
        >
          <source src={resolvedAsset.video.src} type={resolvedAsset.video.mimeType ?? "video/webm"} />
        </video>
      ) : (
        <img
          key={`${state}-image-${imageSrc}`}
          className="mascot-media"
          data-testid="mascot-image"
          src={imageSrc}
          alt={`NyaaGrab mascot — ${state}`}
          draggable={false}
          onError={() => {
            if (imageSrc !== resolvedAsset.fallback) {
              setImageSrc(resolvedAsset.fallback);
            }
          }}
        />
      )}
    </div>
  );
}
