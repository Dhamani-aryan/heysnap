import React from "react";
import { createRoot } from "react-dom/client";
import { CloudApp } from "@ank1015-app/ui";
import "@ank1015-app/ui/filesystem.css";
import "@ank1015-app/ui/cloud.css";
import "./style.css";

const cloudServerUrl = import.meta.env.VITE_CLOUD_SERVER_URL || "https://api.heysnap.xyz";
const localMachineBridge = window.ank1015LocalMachine;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CloudApp
      cloudServerUrl={cloudServerUrl}
      includeLocalMachine
      localMachineBridge={localMachineBridge}
      storageKey="ank1015:desktop-session-token"
    />
  </React.StrictMode>,
);
