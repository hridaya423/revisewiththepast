"use client";

import { useEffect, useRef } from "react";

import { DotCutEngine } from "@/app/_components/paper-maker/dotcut/engine";

export function DotCutCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new DotCutEngine(host, getComputedStyle(host).fontFamily);
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    let routeActive = true;
    let disposed = false;

    const updatePlayback = () => {
      if (motionQuery.matches) {
        engine.stop();
        engine.renderStill();
      } else if (visible && routeActive && !document.hidden) engine.start();
      else engine.stop();
    };
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      updatePlayback();
    });
    const handlePointerMove = (event: PointerEvent) => {
      const bounds = host.getBoundingClientRect();
      engine.setPointer(engine.toCell(event.clientX - bounds.left, event.clientY - bounds.top));
    };
    const handlePointerLeave = () => engine.setPointer(null);
    const handlePageHide = () => {
      routeActive = false;
      updatePlayback();
    };
    const handlePageShow = () => {
      routeActive = true;
      updatePlayback();
    };

    intersectionObserver.observe(host);
    host.addEventListener("pointermove", handlePointerMove);
    host.addEventListener("pointerleave", handlePointerLeave);
    motionQuery.addEventListener("change", updatePlayback);
    document.addEventListener("visibilitychange", updatePlayback);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    void document.fonts.ready.then(() => {
      if (!disposed) engine.refreshFont(getComputedStyle(host).fontFamily);
    });
    updatePlayback();

    return () => {
      disposed = true;
      intersectionObserver.disconnect();
      host.removeEventListener("pointermove", handlePointerMove);
      host.removeEventListener("pointerleave", handlePointerLeave);
      motionQuery.removeEventListener("change", updatePlayback);
      document.removeEventListener("visibilitychange", updatePlayback);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      engine.destroy();
    };
  }, []);

  return <div ref={hostRef} className="dotcut-canvas" aria-hidden="true" />;
}
