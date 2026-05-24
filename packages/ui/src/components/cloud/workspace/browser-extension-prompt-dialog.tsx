"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "motion/react";
import { useEffect } from "react";

const HEYSNAP_CHROME_EXTENSION_URL = "https://chromewebstore.google.com/detail/heysnap/mhbbmhbknbmnfogkmhbjnjmolglaljjn";

export function BrowserExtensionPromptDialog({
  onClose,
}: {
  readonly onClose: () => void;
}): React.ReactElement {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="cloud-modal-backdrop cloud-browser-extension-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <section
        aria-label="Add Heysnap to chrome"
        aria-modal="true"
        className="cloud-modal cloud-browser-extension-modal"
        role="dialog"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h2 className="cloud-browser-extension-title">Add Heysnap to chrome</h2>
        <div className="cloud-browser-extension-pointer-stage" aria-hidden="true">
          <motion.svg
            className="cloud-browser-extension-pointer"
            viewBox="0 0 100 100"
            initial={{ x: -16, y: 8, rotate: -10 }}
            animate={{
              x: [-16, 24, 4, -26, 18, -16],
              y: [8, -10, 18, 2, -16, 8],
              rotate: [-10, 8, -3, 11, -7, -10],
            }}
            transition={{
              duration: 8.5,
              ease: "easeInOut",
              repeat: Infinity,
            }}
          >
            <path
              d="M 25 25 Q 48 30 75 42 Q 48 48 42 75 Q 30 48 25 25 Z"
              fill="#3B83F6"
              stroke="#3B83F6"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="12"
            />
          </motion.svg>
        </div>
        <p className="cloud-browser-extension-copy">
          Add Snap to your chrome to give it more powers and let it do all your chrome work.
        </p>
        <a
          className="cloud-primary-button cloud-browser-extension-action"
          href={HEYSNAP_CHROME_EXTENSION_URL}
          target="_blank"
          rel="noreferrer"
        >
          Add extension
        </a>
        <button
          aria-label="Close extension dialog"
          className="cloud-machines-onboarding-close"
          title="Close"
          type="button"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={18} color="currentColor" strokeWidth={1.8} />
        </button>
      </section>
    </div>
  );
}
