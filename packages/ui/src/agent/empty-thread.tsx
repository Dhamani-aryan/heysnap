"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { RightPromptComposer, type RightPromptComposerProps } from "./prompt-composer";

export interface AgentEmptyThreadProps extends RightPromptComposerProps {
  readonly currentDirectoryName: string;
}

const EMPTY_THREAD_MAX_FONT_SIZE = 22;
const EMPTY_THREAD_MIN_FONT_SIZE = 10;

export const AgentEmptyThread = ({
  ...composerProps
}: AgentEmptyThreadProps): React.ReactElement => {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const questionRef = useRef<HTMLSpanElement | null>(null);
  const [fontSize, setFontSize] = useState(EMPTY_THREAD_MAX_FONT_SIZE);

  const fitQuestionLine = useCallback((): void => {
    const heading = headingRef.current;
    const question = questionRef.current;

    if (heading === null || question === null) {
      return;
    }

    const availableWidth = heading.clientWidth;
    const questionWidth = question.scrollWidth;

    if (availableWidth <= 0 || questionWidth <= 0) {
      return;
    }

    const currentSize = Number.parseFloat(window.getComputedStyle(question).fontSize);
    const nextSize = Math.max(
      EMPTY_THREAD_MIN_FONT_SIZE,
      Math.min(EMPTY_THREAD_MAX_FONT_SIZE, Math.floor((currentSize * availableWidth) / questionWidth)),
    );

    setFontSize((currentFontSize) => currentFontSize === nextSize ? currentFontSize : nextSize);
  }, []);

  useEffect(() => {
    const heading = headingRef.current;

    if (heading === null) {
      return;
    }

    fitQuestionLine();
    const observer = new ResizeObserver(fitQuestionLine);
    observer.observe(heading);

    return () => {
      observer.disconnect();
    };
  }, [fitQuestionLine]);

  useEffect(() => {
    fitQuestionLine();
  }, [fitQuestionLine, fontSize]);

  return (
    <div className="right-prompt-surface">
      <div className="right-empty-thread-center">
        <h1
          ref={headingRef}
          style={{ "--right-empty-thread-font-size": `${fontSize}px` } as CSSProperties}
        >
          <span ref={questionRef} className="right-empty-thread-question">What would you like to do today?</span>
        </h1>
      </div>
      <div className="right-prompt-composer-wrap">
        <RightPromptComposer {...composerProps} />
      </div>
    </div>
  );
};
