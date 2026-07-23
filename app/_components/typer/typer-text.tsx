import type { CSSProperties } from "react";

import styles from "@/app/_components/typer/typer-text.module.css";

type TyperTextProps = {
  children: string;
};

export function TyperText({ children }: TyperTextProps) {
  return (
    <span className={styles.text} aria-label={children}>
      {[...children].map((character, index) => (
        <span
          key={`${character}-${index}`}
          className={styles.char}
          style={{ "--char-index": index } as CSSProperties}
          aria-hidden="true"
        >
          {character === " " ? "\u00a0" : character}
        </span>
      ))}
    </span>
  );
}
