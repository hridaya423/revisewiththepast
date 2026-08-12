"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { EmbossIcon } from "@/app/_components/emboss/emboss-icon";
import { EMBOSS_PRESETS } from "@/app/_components/emboss/params";
import { SUBJECT_COLORS, SUBJECT_ICONS } from "@/app/_components/subject-presentation";

export type SubjectWheelItem = {
  title: string;
  subjectKey: string;
  routes: Array<{
    key: string;
    boardLabel: string;
    tierLabel?: string;
  }>;
};

const ROW_HEIGHT = 62;
const TILT = 10;
const CURVE = 0.82;
const TRACKPAD_STEP_PX = 100;
const WHEEL_NOTCH_THRESHOLD_PX = 60;
const SPRING_STIFFNESS = 190;
const SPRING_DAMPING = 27.5;

function clampPosition(value: number, itemCount: number) {
  return Math.max(0, Math.min(itemCount - 1, value));
}

function normalizeWheelDelta(event: WheelEvent) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 24;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * window.innerHeight;
  return event.deltaY;
}

function geometry(distance: number) {
  const angle = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, distance * TILT * Math.PI / 180));
  const radius = ROW_HEIGHT / (TILT * Math.PI / 180);
  const x = -radius * (1 - Math.cos(angle)) * CURVE;
  const y = radius * Math.sin(angle);
  const rotation = angle * 180 / Math.PI;
  const opacity = Math.max(0.08, 1 - Math.abs(distance) * 0.2);
  const blur = Math.abs(distance) * 0.7;
  return { x, y, rotation, opacity, blur };
}

function optionStyle(index: number, position: number): CSSProperties {
  const { x, y, rotation, opacity, blur } = geometry(index - position);
  return {
    opacity,
    filter: `blur(${blur.toFixed(2)}px)`,
    transform: `translate(${x.toFixed(2)}px, calc(${y.toFixed(2)}px - 50%)) rotate(${rotation.toFixed(2)}deg)`,
  };
}

export function SubjectOptionWheel({ items }: { items: SubjectWheelItem[] }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const positionRef = useRef(0);
  const targetRef = useRef(0);
  const velocityRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const dragRef = useRef<{ pointerId: number; startY: number; startPosition: number; lastY: number; lastTime: number; velocity: number } | null>(null);
  const wheelTimerRef = useRef<number | null>(null);
  const reduceMotionRef = useRef(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [settled, setSettled] = useState(true);

  const paint = useCallback((position: number) => {
    optionRefs.current.forEach((element, index) => {
      if (!element) return;
      const style = optionStyle(index, position);
      element.style.transform = String(style.transform);
      element.style.opacity = String(style.opacity);
      element.style.filter = String(style.filter);
      element.style.setProperty("--wheel-proximity", String(Math.max(0, 1 - Math.min(1, Math.abs(index - position)))));
    });
  }, []);

  const animate = useCallback(function tick(now: number) {
    const elapsed = Math.min(1 / 30, Math.max(1 / 240, (now - lastRef.current) / 1000));
    lastRef.current = now;

    const displacement = targetRef.current - positionRef.current;
    const acceleration = displacement * SPRING_STIFFNESS - velocityRef.current * SPRING_DAMPING;
    velocityRef.current += acceleration * elapsed;
    positionRef.current += velocityRef.current * elapsed;

    const settled = Math.abs(displacement) < 0.001 && Math.abs(velocityRef.current) < 0.01;
    if (settled) {
      positionRef.current = targetRef.current;
      velocityRef.current = 0;
    }
    paint(positionRef.current);
    if (settled) setSettled(true);
    frameRef.current = settled ? null : window.requestAnimationFrame(tick);
  }, [paint]);

  const startAnimation = useCallback(() => {
    if (reduceMotionRef.current) {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      positionRef.current = targetRef.current;
      velocityRef.current = 0;
      paint(positionRef.current);
      setSettled(true);
      frameRef.current = null;
      return;
    }
    setSettled(false);
    if (frameRef.current !== null) return;
    lastRef.current = performance.now();
    frameRef.current = window.requestAnimationFrame(animate);
  }, [animate, paint]);

  const select = useCallback((value: number) => {
    const next = clampPosition(value, items.length);
    targetRef.current = next;
    const rounded = Math.round(next);
    setSelectedIndex((current) => current === rounded ? current : rounded);
    startAnimation();
  }, [items.length, startAnimation]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => {
      reduceMotionRef.current = query.matches;
      if (query.matches) {
        if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        positionRef.current = targetRef.current;
        velocityRef.current = 0;
        paint(positionRef.current);
      }
    };
    syncMotion();
    query.addEventListener("change", syncMotion);
    paint(positionRef.current);
    return () => query.removeEventListener("change", syncMotion);
  }, [paint]);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
  }, []);

  const handleWheel = useCallback((event: WheelEvent) => {
    const frame = shellRef.current;
    if (!frame) return;
    const bounds = frame.getBoundingClientRect();
    const captureLine = window.innerHeight * 0.5;
    if (bounds.top > captureLine || bounds.bottom < captureLine) return;

    const delta = normalizeWheelDelta(event);
    if (Math.abs(delta) < 0.5) return;

    const atStart = targetRef.current <= 0.001 && delta < 0;
    const atEnd = targetRef.current >= items.length - 1.001 && delta > 0;
    if (atStart || atEnd) return;

    event.preventDefault();
    const discreteNotch = Math.abs(delta) >= WHEEL_NOTCH_THRESHOLD_PX;
    const next = discreteNotch
      ? Math.round(targetRef.current) + Math.sign(delta)
      : targetRef.current + delta / TRACKPAD_STEP_PX;
    targetRef.current = clampPosition(next, items.length);
    velocityRef.current += discreteNotch ? Math.sign(delta) * 3.5 : delta / TRACKPAD_STEP_PX * 4;
    setSelectedIndex(Math.round(targetRef.current));
    startAnimation();

    if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = window.setTimeout(() => select(Math.round(targetRef.current)), 140);
  }, [items.length, select, startAnimation]);

  useEffect(() => {
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    velocityRef.current = 0;
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startPosition: positionRef.current, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0 };
    setSettled(false);
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const distance = event.clientY - drag.startY;
    if (Math.abs(distance) > 4 && !rootRef.current?.hasPointerCapture(drag.pointerId)) {
      rootRef.current?.setPointerCapture(drag.pointerId);
    }
    const elapsed = Math.max(8, event.timeStamp - drag.lastTime) / 1000;
    drag.velocity = Math.max(-8, Math.min(8, -(event.clientY - drag.lastY) / ROW_HEIGHT / elapsed));
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    targetRef.current = clampPosition(drag.startPosition - distance / ROW_HEIGHT, items.length);
    positionRef.current = targetRef.current;
    setSelectedIndex(Math.round(targetRef.current));
    paint(positionRef.current);
  };

  const handlePointerEnd = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    velocityRef.current = drag.velocity;
    select(Math.round(clampPosition(targetRef.current + drag.velocity * 0.12, items.length)));
  };

  const handlePointerCancel = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    velocityRef.current = 0;
    select(Math.round(positionRef.current));
  };

  const active = items[selectedIndex] ?? items[0];
  const presentation = SUBJECT_COLORS[active?.subjectKey] ?? { accent: "#4747D8", soft: "#F0F0FF" };
  const Icon = active ? SUBJECT_ICONS[active.subjectKey] : undefined;

  return (
    <div className="subject-wheel-frame" ref={shellRef}>
      <div
        aria-activedescendant={`subject-wheel-option-${selectedIndex}`}
        aria-label="Choose a subject"
        className={`subject-option-wheel${dragging ? " is-dragging" : ""}`}
        data-wheel-settled={settled ? "true" : "false"}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowRight") {
            event.preventDefault();
            select(Math.round(targetRef.current) + 1);
          } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
            event.preventDefault();
            select(Math.round(targetRef.current) - 1);
          } else if (event.key === "Home") {
            event.preventDefault();
            select(0);
          } else if (event.key === "End") {
            event.preventDefault();
            select(items.length - 1);
          }
        }}
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        ref={rootRef}
        role="listbox"
        tabIndex={0}
      >
        <span className="subject-wheel-axis" aria-hidden="true" />
        {items.map((item, index) => (
          <button
            aria-selected={selectedIndex === index}
            className="subject-wheel-option"
            id={`subject-wheel-option-${index}`}
            key={item.title}
            onClick={() => select(index)}
            ref={(element) => { optionRefs.current[index] = element; }}
            role="option"
            style={optionStyle(index, 0)}
            tabIndex={-1}
            type="button"
          >
            {item.title}
          </button>
        ))}
      </div>

      {active ? (
        <div className="subject-wheel-panel" data-subject-wheel-panel key={active.title}>
          <div className="subject-wheel-panel-mark">
            {Icon ? <EmbossIcon icon={Icon} flag={active.subjectKey === "edexcel-french-reading" ? "fr" : undefined} color={presentation.accent} surface="#E4E1D8" params={EMBOSS_PRESETS.subject} size={56} /> : null}
          </div>
          <h3 className="subject-wheel-panel-title text-[clamp(1.8rem,4vw,3.3rem)] font-extrabold leading-none tracking-[-0.055em] text-text">{active.title}</h3>
          <p className="mt-4 max-w-[34ch] text-[0.76rem] leading-6 text-text-muted">Choose your exam board to start building a paper for this course.</p>
          <div className="mt-8 border-t border-text/12">
            {active.routes.map((route) => (
              <Link
                className="group flex min-h-14 items-center justify-between border-b border-text/12 text-[0.73rem] font-bold text-text-secondary transition-colors hover:text-accent"
                href={`/paper-maker?subject=${route.key}`}
                key={route.key}
                transitionTypes={["nav-forward"]}
              >
                <span>{route.boardLabel}{route.tierLabel ? ` · ${route.tierLabel}` : ""}</span>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
