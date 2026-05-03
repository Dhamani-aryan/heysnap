import React from "react";
import { createRoot } from "react-dom/client";
import { FilesystemExplorer } from "@ank1015-app/ui";
import "@ank1015-app/ui/filesystem.css";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FilesystemExplorer websocketUrl={import.meta.env.VITE_FILESYSTEM_WS_URL} />
  </React.StrictMode>,
);
