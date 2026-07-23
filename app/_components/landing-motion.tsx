"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function LandingMotion() {
  useGSAP(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      return;
    }

    gsap.from("[data-hero-reveal]", {
      autoAlpha: 0,
      y: 22,
      duration: 0.85,
      stagger: 0.1,
      ease: "power3.out",
    });

    ScrollTrigger.batch("[data-scroll-reveal]", {
      start: "top 88%",
      once: true,
      onEnter: (elements) => {
        gsap.fromTo(
          elements,
          { autoAlpha: 0, y: 28 },
          { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.08, ease: "power3.out", overwrite: true },
        );
      },
    });

  });

  return null;
}
