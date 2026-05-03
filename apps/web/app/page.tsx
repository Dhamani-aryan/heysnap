import { FilesystemExplorer } from "@ank1015-app/ui";

export default function Page() {
  return <FilesystemExplorer websocketUrl={process.env.NEXT_PUBLIC_FILESYSTEM_WS_URL} />;
}
