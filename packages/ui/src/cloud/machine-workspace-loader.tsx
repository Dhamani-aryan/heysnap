"use client";

import { motion } from "motion/react";

import macImageUrl from "../../../../apps/assets/mac.png";
import newMacImageUrl from "../../../../apps/assets/new-mac.png";
import type { CloudComputer } from "./cloud-client";

type ImageAsset = string | { readonly src: string };

export const WORKSPACE_TRANSITION = { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const };

const getImageSrc = (asset: ImageAsset): string => {
  return typeof asset === "string" ? asset : asset.src;
};

export function MachineWorkspaceLoader({
  ariaLabel,
  computer,
  label,
}: {
  readonly ariaLabel: string;
  readonly computer: CloudComputer;
  readonly label: string;
}): React.ReactElement {
  const loaderImageUrl = computer.kind === "local" ? newMacImageUrl : macImageUrl;

  return (
    <motion.section
      className="cloud-workspace-loader"
      aria-label={ariaLabel}
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -6 }}
      transition={WORKSPACE_TRANSITION}
    >
      <img
        className="cloud-workspace-loader-image"
        src={getImageSrc(loaderImageUrl)}
        alt=""
        aria-hidden="true"
      />
      <p>{label}</p>
    </motion.section>
  );
}
