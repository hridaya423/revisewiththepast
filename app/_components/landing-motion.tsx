"use client";

import { useEffect } from "react";

export function LandingMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const heroElements = Array.from(document.querySelectorAll<HTMLElement>("[data-hero-reveal]"));
    heroElements.forEach((element, index) => {
      element.animate(
        [
          { opacity: 0.72, transform: "translateY(12px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 420, delay: index * 55, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "both" },
      );
    });

    const reveals = Array.from(document.querySelectorAll<HTMLElement>("[data-scroll-reveal]"));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const element = entry.target as HTMLElement;
        element.animate(
          [{ opacity: 0.76, transform: "translateY(12px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 360, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "both" },
        );
        observer.unobserve(element);
      });
    }, { rootMargin: "0px 0px -8%", threshold: 0.12 });

    reveals.forEach((element) => observer.observe(element));

    const proof = document.querySelector<HTMLElement>("[data-marking-proof]");
    const proofObserver = proof
      ? new IntersectionObserver((entries) => {
          const entry = entries[0];
          if (!entry?.isIntersecting) return;

          proof.dataset.proofAnimated = "true";
          const sequence = [
            ["[data-proof-answer]", 0],
            ["[data-proof-evidence]", 110],
            ["[data-proof-score]", 230],
            ["[data-proof-next]", 330],
          ] as const;

          sequence.forEach(([selector, delay]) => {
            proof.querySelector<HTMLElement>(selector)?.animate(
              [
                { opacity: 0.7, filter: "blur(5px)", transform: "translateY(7px)" },
                { opacity: 1, filter: "blur(0)", transform: "translateY(0)" },
              ],
              {
                duration: 440,
                delay,
                easing: "cubic-bezier(0.16, 1, 0.3, 1)",
                fill: "both",
              },
            );
          });
          proofObserver?.disconnect();
        }, { rootMargin: "0px 0px -12%", threshold: 0.34 })
      : null;

    if (proof && proofObserver) proofObserver.observe(proof);
    return () => {
      observer.disconnect();
      proofObserver?.disconnect();
    };
  }, []);

  return null;
}
