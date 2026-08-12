"use client";

import { useEffect, useState, type CSSProperties } from "react";

import styles from "@/app/_components/typer/typer-text.module.css";

export function TyperText({ children }: { children: string }) {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setAnimate(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <span className={styles.text} data-typer-text data-animate={animate} aria-label={children}>
      {[...children].map((character, index) => (
        <span key={`${character}-${index}`} className={styles.char} style={{ "--char-index": index } as CSSProperties} aria-hidden="true">
          {character}
        </span>
      ))}
    </span>
  );
}
