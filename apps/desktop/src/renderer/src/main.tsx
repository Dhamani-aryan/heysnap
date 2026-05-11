import React from "react";
import { createRoot } from "react-dom/client";
import { CloudApp, CloudRuntimeProvider } from "@ank1015-app/ui";
import "@ank1015-app/ui/filesystem.css";
import "@ank1015-app/ui/cloud.css";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";
import "./style.css";
import { DesktopUpdatePrompt } from "./update-prompt";

const cloudServerUrl = import.meta.env.VITE_CLOUD_SERVER_URL || "https://api.heysnap.xyz";

function DesktopTitleBar(): React.ReactElement {
  return (
    <div
      className="desktop-titlebar"
      onDoubleClick={() => {
        void window.ank1015DesktopWindow?.toggleFullscreen();
      }}
    >
      <div className="desktop-titlebar-title">HeySnap</div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <>
      <DesktopTitleBar />
      <CloudRuntimeProvider
        cloudServerUrl={cloudServerUrl}
        storageKey="ank1015:desktop-session-token"
      >
        <CloudApp />
      </CloudRuntimeProvider>
      <DesktopUpdatePrompt />
    </>
  </React.StrictMode>,
);
