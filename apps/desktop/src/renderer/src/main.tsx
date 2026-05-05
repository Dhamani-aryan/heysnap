import React from "react";
import { createRoot } from "react-dom/client";
import { CloudApp } from "@ank1015-app/ui";
import "@ank1015-app/ui/filesystem.css";
import "@ank1015-app/ui/cloud.css";
import "./style.css";
import { DesktopUpdatePrompt } from "./update-prompt";

const cloudServerUrl = import.meta.env.VITE_CLOUD_SERVER_URL || "https://api.heysnap.xyz";
const localMachineBridge = window.ank1015LocalMachine;

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
      <CloudApp
        cloudServerUrl={cloudServerUrl}
        includeLocalMachine
        localMachineBridge={localMachineBridge}
        storageKey="ank1015:desktop-session-token"
      />
      <DesktopUpdatePrompt />
    </>
  </React.StrictMode>,
);
